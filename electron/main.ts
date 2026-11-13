import { app, ipcMain, Tray, Menu, nativeImage, shell, protocol, desktopCapturer, dialog, nativeTheme, Notification, powerMonitor, session } from 'electron';
import path from 'path';
import fs from 'fs';
import { spawnSync } from 'child_process';
import { Readable } from 'stream';
import { appRoot } from './utils/paths';

import { getConfig, setConfig, setMultipleConfig } from './utils/config';
import logger from './utils/logger';
import { errorMessage } from './utils/errors';
import { startWebSocketServer, stopWebSocketServer, broadcastToExtension } from './websocket-server';
import { startRecording, stopRecording, listAudioDevices, probeAudioDevice, ffmpegSupportsPulse, convertWebmToWav, convertFileToWav, getMediaDurationSeconds } from './audio/recorder';
import { pulseInfo } from './audio/pulse';
import { locate } from './audio/ffmpeg-path';
import { silenceHints } from './audio/audio-hints';
import { getSessionWaveform, deleteSessionWaveform } from './audio/waveform';
import { createRecordingsStorage } from './services/recordings-storage';
import { transcribe } from './services/transcription';
import { generateNotes } from './services/notes';
import { cleanTitle, sourceMeetingTitle, applyMeetingTitle, resolveMeetingSource } from './services/meeting-title';
import { DEFAULT_SYSTEM_PROMPT, DEFAULT_MD_SYSTEM_PROMPT } from './services/prompts';
import { registries, describeProviders } from './providers';
import { uploadToNotion, testNotionConnection, trashNotionPage } from './services/notion';
import { exportPdf, buildPdfFileName, resolveExportDir } from './services/pdf-export';
import { initializeAutoUpdater, checkForUpdates, downloadUpdate, quitAndInstall, getUpdaterState, applyUpdateSettings, takeHiddenRelaunch } from './services/updater';
import { isIdleForUpdate } from './services/update-policy';
import * as calendar from './calendar';
import * as db from './db/sessions';
import * as meetingDetector from './detection/meeting-detector';
import { showOverlay, hideOverlay, destroyOverlay, recheckOverlay, setOverlayTheme, registerOverlayIpc } from './overlay/overlay-window';
import { getPermissionStatus, requestPermission, openPermissionSettings } from './services/permissions';
import { normalizeMacCaptureStrategy } from './audio/mac-capture';
import { createAutoLaunch, HIDDEN_ARG } from './services/auto-launch';
import { registerMainWindowIpc, openMainWindow, getMainWindow, isMainWindowVisible, sendToMainWindow, recheckMainWindow, getViewState } from './window/main-window';
import { registerCaptureIpc, startCapture, stopCapture, destroyCapture } from './audio/capture-window';

import type { DisplayMediaRequestHandlerHandlerRequest, IpcMainEvent, IpcMainInvokeEvent, MenuItemConstructorOptions, OpenDialogOptions, Streams } from 'electron';
import type {
  AppState, CalendarAddInput, CalendarOutcome, CalendarUpdatePatch, Config, FfmpegBinaryInfo, DetectedMeeting, EffectiveTheme, IpcInvokeMap, IpcSendMap, MacCaptureStrategy, Notes,
  NotesPreview, OverlayState, ProcessingProgressStage, RecordingResult, RendererErrorReport, Session, SessionUpdate, TranscriptSegment,
  UpdaterStatus,
} from './shared';
import type { ExtensionBroadcast } from './websocket-server';

// `ipcMain` with `handle` and `on` checked against the channel maps in electron/shared/ipc.ts: a
// handler's arguments and result must match what the renderer's window.meetmind promises. Same
// object at runtime, only the type differs.
type TypedIpcMain = {
  handle<C extends keyof IpcInvokeMap>(
    channel: C,
    listener: (event: IpcMainInvokeEvent, ...args: IpcInvokeMap[C]['args']) => IpcInvokeMap[C]['result'] | Promise<IpcInvokeMap[C]['result']>,
  ): void;
  on<C extends keyof IpcSendMap>(
    channel: C,
    listener: (event: IpcMainEvent, ...args: IpcSendMap[C]) => void,
  ): void;
};
const ipc = ipcMain as unknown as TypedIpcMain;

// A fresh meeting ID. Loaded on first use, like the rest of the recording path.
function newSessionId(): string {
  const { v4 }: { v4: () => string } = require('uuid');
  return v4();
}

// A recording or processing status, for the Chrome extension and the meeting overlay.
interface StatusMessage extends ExtensionBroadcast {
  type: 'RECORDING_STARTED' | 'RECORDING_STOPPED' | 'PROCESSING_PROGRESS' | 'PROCESSING_COMPLETE' | 'PROCESSING_ERROR' | 'PROCESSING_CANCELLED';
  sessionId?: string;
  stage?: string;
  percent?: number;
  notionUrl?: string | null;
  error?: string;
}

// The "meeting detected" fallback notification, tagged with the meeting it offers.
type MeetingToast = Notification & { meetingKey?: string };

type SendProgress = (stage: ProcessingProgressStage, percent: number) => void;

// A processing run aborted because its meeting was deleted (see abortIfCancelled).
function isPipelineCancelled(err: unknown): boolean {
  return typeof err === 'object' && err !== null && '_cancelled' in err && !!err._cancelled;
}

// A calendar action the user cancelled (closing the Google sign-in).
function isActionCancelled(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'cancelled' in err && !!err.cancelled;
}

const isDev = process.env.NODE_ENV === 'development';
const isMac = process.platform === 'darwin';
const isLinux = process.platform === 'linux';

// Linux: on a Wayland session, run through XWayland when it is there. Native Wayland doesn't let
// an app keep a window on top or place it, which the meeting overlay needs, nor read other apps'
// window titles, which meeting detection needs. Must be set before the app is ready.
if (isLinux && process.env.DISPLAY) app.commandLine.appendSwitch('ozone-platform', 'x11');

// Windows: Chromium stops drawing a window it believes is covered or hidden ("native window
// occlusion"), and a window shown again after a long time in the tray can stay blank. The main
// window is also health-checked whenever it is shown (window/main-window.ts); this removes one
// known cause. Must be set before the app is ready.
if (process.platform === 'win32') app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');

// Launch at login (services/auto-launch.ts). A login launch on Windows and Linux passes --hidden,
// so the app starts in the tray and only meeting detection and the overlay show up. Only the
// packaged app registers: an unpackaged run (pnpm run dev, the run-meetmind driver) would point
// the entry at the bare dev electron binary.
const autoLaunch = createAutoLaunch({ app, isDev: !app.isPackaged, logger });
const launchedHidden = !isMac && process.argv.includes(HIDDEN_ARG);

// Uploads a session's notes to Notion. If the session already has a page (re-sync or
// regenerated notes), the new page is created first and the old one is then moved to Notion's
// trash, so each meeting keeps a single page and a failed upload never loses the old one.
async function uploadSessionToNotion(sessionId: string, notes: Notes, transcript: TranscriptSegment[], config: Config) {
  const previousUrl = db.getSession(sessionId)?.notion_page_url || null;
  const url = await uploadToNotion(notes, transcript, config.notionPageId, config.notionToken, {
    includeTranscript: config.notionUploadTranscript !== false,
  });
  if (previousUrl && previousUrl !== url) {
    await trashNotionPage(previousUrl, config.notionToken);
  }
  return url;
}

// Top-level crash guards for main process
process.on('uncaughtException', (err) => {
  logger.error('Uncaught Exception in main process', {
    error: errorMessage(err) || String(err),
    stack: err?.stack,
  });
});

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled Rejection in main process', {
    reason: reason instanceof Error ? reason.message : String(reason),
    stack: reason instanceof Error ? reason.stack : undefined,
  });
});

// The notes stage owns 60–84% of the progress bar; 85% is reached when the notes are saved.
const NOTES_PROGRESS_START = 60;
const NOTES_PROGRESS_END = 84;

// Map the estimated share of the notes written onto the notes stage's band. Only moves
// forward, so a fallback starting over doesn't send the bar backwards.
function notesProgressReporter(sendProgress: SendProgress) {
  let last = NOTES_PROGRESS_START;
  return (fraction: number) => {
    const span = NOTES_PROGRESS_END - NOTES_PROGRESS_START + 1;
    const pct = Math.min(NOTES_PROGRESS_END, NOTES_PROGRESS_START + Math.floor(fraction * span));
    if (pct <= last) return;
    last = pct;
    sendProgress('generating', pct);
  };
}

// Runs the notes stage: generate with the configured LLM (and fallback), streaming a live
// preview to the renderer and advancing the progress bar as the notes arrive, stamp
// provenance into the notes blob for the renderer, and announce a fallback if one was used.
async function generateAndStampNotes(
  sessionId: string,
  transcript: TranscriptSegment[],
  config: Config,
  sttInfo: { provider: string; model: string },
  meetingTitle: string | null | undefined,
  sendProgress?: SendProgress,
) {
  const reportProgress = sendProgress ? notesProgressReporter(sendProgress) : null;
  const result = await generateNotes(transcript, config, {
    meetingTitle: meetingTitle || '',
    onPreview: (preview) => {
      currentNotesPreview = { sessionId, ...preview };
      sendToRenderer('notes:preview', currentNotesPreview);
      if (preview.progress != null) reportProgress?.(preview.progress);
    },
  });
  const notes = result.notes;

  notes._llmProvider = result.provider;
  notes._llmModel = result.model;
  notes._geminiModel = result.model; // kept so older readers still show the model
  notes._sttService = sttInfo.provider;
  if (sttInfo.model) notes._sttModel = sttInfo.model;

  if (result.fallback) {
    sendToRenderer('llm:fallback-used', {
      sessionId,
      primaryProvider: result.fallback.primary.provider,
      primaryModel: result.fallback.primary.model,
      fallbackProvider: result.provider,
      fallbackModel: result.model,
    });
    logger.info('Fallback LLM was used', { primary: result.fallback.primary, fallback: { provider: result.provider, model: result.model } });
  }
  return notes;
}

// Ensure a single running instance (prevents duplicate windows/tray icons)
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => {
    focusMainWindow();
    const protocolUrl = argv.find((arg) => typeof arg === 'string' && arg.startsWith('meetmind://'));
    if (protocolUrl) logger.info('Opened via protocol', { protocolUrl });
  });
}

// macOS delivers meetmind:// links through open-url, not argv. Registered before `ready` so the
// link that launched the app isn't lost; at launch the window opens anyway, so it only needs
// focusing once the app is up.
app.on('open-url', (event, url) => {
  event.preventDefault();
  if (!url.startsWith('meetmind://')) return;
  logger.info('Opened via protocol', { protocolUrl: url });
  if (app.isReady()) focusMainWindow();
});

// Only the packaged app should own meetmind://.
// Registering from `pnpm run dev` steals the handler and points it at electron.exe,
// so "Open App" from the extension fails after install.
if (app.isPackaged) {
  app.setAsDefaultProtocolClient('meetmind');
}

// Must be called before app.whenReady() to allow media playback from meetmind-audio://
protocol.registerSchemesAsPrivileged([{
  scheme: 'meetmind-audio',
  privileges: {
    standard: true,
    secure: true,
    supportFetchAPI: true,
    stream: true,
    bypassCSP: true,
  },
}]);

let tray: Tray | null = null;
let isRecording = false;

// Where every meeting's audio lives: <sessionId>.wav, or .webm while recording.
function getRecordingsDir() {
  return path.join(app.getPath('userData'), 'recordings');
}

// Every database write reaches the renderer as one sessions:changed event (a burst of writes, like
// the duration backfill, is sent once), so the Dashboard, Meetings and an open meeting show each
// status change the moment it is saved: recording → transcribing → writing notes → complete.
const SESSIONS_CHANGED_DELAY_MS = 30;
let sessionsChangedTimer: ReturnType<typeof setTimeout> | null = null;
db.onChange(() => {
  if (sessionsChangedTimer) return;
  sessionsChangedTimer = setTimeout(() => {
    sessionsChangedTimer = null;
    sendToRenderer('sessions:changed', { revision: db.getRevision() });
  }, SESSIONS_CHANGED_DELAY_MS);
});

// The main window is disposable (window/main-window.ts): there may be none, or one still
// loading. A message for a missing window is dropped, which is right for status events: a new
// window reads the current state through app:state.
function sendToRenderer(channel: string, ...args: unknown[]) {
  return sendToMainWindow(channel, args);
}

// For the few events that must survive the window not being up yet ("open this meeting", a
// meeting starting): kept for a few minutes and delivered once the renderer is ready.
function sendToRendererQueued(channel: string, ...args: unknown[]) {
  return sendToMainWindow(channel, args, { queue: true });
}

function focusMainWindow() {
  openMainWindow();
}

// ── Window ──────────────────────────────────────────────────────────────────

// The theme actually shown ('light' | 'dark') for a theme setting, resolving 'system'.
function resolveEffectiveTheme(themeSetting: unknown): EffectiveTheme {
  return themeSetting === 'system'
    ? (nativeTheme.shouldUseDarkColors ? 'dark' : 'light')
    : (themeSetting === 'dark' ? 'dark' : 'light');
}

// Window background painted before the renderer's first frame — must match the
// theme the renderer is about to apply, otherwise the window flashes.
function resolveStartupBackgroundColor(themeSetting: unknown) {
  return resolveEffectiveTheme(themeSetting) === 'light' ? '#f8f5ed' : '#1a1813';  // matches --color-paper
}

// ── System audio (getDisplayMedia) ──────────────────────────────────────────
// The capture window records system audio with getDisplayMedia(); this handler approves it without a
// picker and asks Electron for 'loopback' audio. On Windows that is Chromium's WASAPI loopback,
// which captures all system audio (speakers, headphones, USB, Bluetooth). On macOS 14.2+ it is
// the CoreAudio Tap API; how the required video source is supplied is configurable there (see
// electron/audio/mac-capture.ts), and Settings' "Test system audio" can try each strategy.

// Strategy for the test capture currently running, overriding config.macCaptureStrategy.
let testCaptureStrategy: MacCaptureStrategy | null = null;

function screenLoopbackHandler(_request: DisplayMediaRequestHandlerHandlerRequest, callback: (streams: Streams | null) => void) {
  desktopCapturer.getSources({ types: ['screen'] }).then((sources) => {
    if (sources.length === 0) { callback(null); return; }
    callback({ video: sources[0], audio: 'loopback' });
  }).catch(() => {
    callback(null);
  });
}

// Own window frame as the video source (macOS 'frame' strategy); a screen if there's no frame.
function frameLoopbackHandler(request: DisplayMediaRequestHandlerHandlerRequest, callback: (streams: Streams | null) => void) {
  if (request.frame) callback({ video: request.frame, audio: 'loopback' });
  else screenLoopbackHandler(request, callback);
}

function currentMacCaptureStrategy() {
  return normalizeMacCaptureStrategy(testCaptureStrategy || getConfig().macCaptureStrategy);
}

// Installed on the default session, which the capture window (recordings) and the main window
// (Settings' "Test system audio") share. Needs the app to be ready.
function installDisplayMediaHandler() {
  const ses = session.defaultSession;
  if (!isMac) {
    ses.setDisplayMediaRequestHandler(screenLoopbackHandler, { useSystemPicker: false });
    return;
  }
  const strategy = currentMacCaptureStrategy();
  if (strategy === 'picker') {
    // macOS 15+ shows its own picker (the handler then isn't called); 14.x falls back to it.
    ses.setDisplayMediaRequestHandler(screenLoopbackHandler, { useSystemPicker: true });
  } else {
    ses.setDisplayMediaRequestHandler(
      strategy === 'frame' ? frameLoopbackHandler : screenLoopbackHandler,
      { useSystemPicker: false },
    );
  }
}

function resolveIconPath(...candidates: Array<string | null | undefined>) {
  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) return candidate;
  }
  return undefined;
}

function getAppIconPath() {
  // Prefer .ico on Windows for taskbar / window chrome; fall back to PNG. Electron can't read
  // .ico on Linux.
  return resolveIconPath(
    isLinux ? null : path.join(appRoot, 'assets/icons/icon.ico'),
    path.join(appRoot, 'assets/icons/icon256.png'),
    path.join(appRoot, 'assets/icons/icon128.png'),
  );
}

function getTrayIcon() {
  // macOS menu bar: a monochrome template image (trayTemplate@2x.png is picked up for Retina),
  // which macOS tints to match light and dark menu bars.
  if (isMac) {
    const templatePath = resolveIconPath(path.join(appRoot, 'assets/icons/trayTemplate.png'));
    if (templatePath) {
      const image = nativeImage.createFromPath(templatePath);
      image.setTemplateImage(true);
      return image;
    }
  }

  // Windows tray looks crisp at 16/32; avoid empty/placeholder images.
  const trayPath = resolveIconPath(
    path.join(appRoot, 'assets/icons/icon32.png'),
    path.join(appRoot, 'assets/icons/icon16.png'),
    path.join(appRoot, 'assets/icons/icon.ico'),
  );

  if (!trayPath) return nativeImage.createEmpty();

  let image = nativeImage.createFromPath(trayPath);
  if (image.isEmpty()) return nativeImage.createEmpty();

  // Keep tray icon small; Windows scales poorly from large sources.
  const { width } = image.getSize();
  if (width > 32) {
    image = image.resize({ width: 32, height: 32, quality: 'best' });
  }
  return image;
}

// ── macOS application menu ──────────────────────────────────────────────────
// macOS shows a menu bar for the focused app; without Edit/Window menus the standard shortcuts
// (⌘C/⌘V/⌘A, ⌘W, ⌘M) don't work. Windows has a frameless window and no menu.

function createAppMenu() {
  if (!isMac) return;
  const template: MenuItemConstructorOptions[] = [
    {
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        {
          label: 'Settings…',
          accelerator: 'Cmd+,',
          click: () => { focusMainWindow(); sendToRendererQueued('app:navigate', 'settings'); },
        },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    { role: 'editMenu' },
    { role: 'windowMenu' },
  ];
  if (isDev) template.push({ role: 'viewMenu' });
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ── Tray ─────────────────────────────────────────────────────────────────────

function createTray() {
  const icon = getTrayIcon();
  tray = new Tray(icon);
  tray.setToolTip('MeetMind');
  updateTrayMenu();

  tray.on('click', () => {
    focusMainWindow();
  });

  tray.on('double-click', () => {
    focusMainWindow();
  });
}

let lastTrayUpdaterStatus: UpdaterStatus | null = null;

function updateTrayMenu() {
  if (!tray) return;
  const updaterState = getUpdaterState();

  const menuItems: MenuItemConstructorOptions[] = [
    {
      label: 'Open MeetMind',
      click: () => { focusMainWindow(); },
    },
    { type: 'separator' },
  ];

  if (updaterState.status === 'downloaded') {
    menuItems.push({
      label: `✨ Restart to Update (v${updaterState.updateInfo?.version || ''})`,
      click: () => { quitAndInstall(); },
    });
    menuItems.push({ type: 'separator' });
  } else if (updaterState.status === 'available') {
    menuItems.push({
      label: `⬇ ${updaterState.canSelfUpdate ? 'Download Update' : 'Get Update from GitHub'} (v${updaterState.updateInfo?.version || ''})`,
      click: async () => { focusMainWindow(); await downloadUpdate(); },
    });
    menuItems.push({ type: 'separator' });
  }

  menuItems.push(
    {
      label: isRecording ? '⏹ Stop Recording' : '⏺ Start Recording',
      click: async () => {
        if (isRecording) {
          await handleStopRecording();
        } else {
          await handleStartRecording();
        }
      },
    },
    { type: 'separator' },
    {
      label: 'Check for Updates...',
      click: async () => {
        focusMainWindow();
        await checkForUpdates(true);
      },
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        app.isQuitting = true;
        app.quit();
      },
    },
  );

  const contextMenu = Menu.buildFromTemplate(menuItems);
  tray.setContextMenu(contextMenu);
}

// ── Recording helpers ────────────────────────────────────────────────────────

let currentSessionId: string | null = null;
let recordingStartedAt: number | null = null;   // ms; lets a newly opened window show the right elapsed time
let captureMode: 'none' | 'renderer' | 'ffmpeg' = 'none';
let rendererWriteStream: fs.WriteStream | null = null; // WriteStream for incremental renderer capture
let rendererWebmPath: string | null = null; // Path to the in-progress .webm file
let rendererChunkCount = 0;     // Number of chunks flushed to disk
let rendererBytesWritten = 0;   // Total bytes flushed to disk

// Sessions deleted while the processing pipeline is still in flight. The
// pipeline checks this set before each expensive stage and aborts early.
const cancelledSessions = new Set<string>();

// ── Renderer capture IPC helpers ─────────────────────────────────────────────

// Whether main can record system audio itself with FFmpeg if the renderer gets none: always on
// Windows (WASAPI loopback); on Linux when PulseAudio (or pipewire-pulse) answers and this FFmpeg
// can record from it; never on macOS. When it can, the renderer fails rather than record the
// microphone alone, so the FFmpeg fallback below takes over.
async function canRecordSystemAudioWithFfmpeg() {
  if (isMac) return false;
  if (!isLinux) return true;
  try {
    const info = await pulseInfo();
    return !!info.defaultSink && ffmpegSupportsPulse();
  } catch {
    return false;
  }
}

// Starts the capture window (audio/capture-window.ts). True once audio is flowing.
async function requestRendererCaptureStart() {
  const requireSystemAudio = await canRecordSystemAudioWithFfmpeg();
  // macOS may show permission prompts (screen & system audio, microphone) on the first
  // recording, so give the user time to answer them.
  const result = await startCapture({ requireSystemAudio, timeoutMs: isMac ? 60000 : 6000 });
  if (!result.ok) {
    logger.warn('Capture window could not start', { error: result.error });
    return false;
  }
  if (!result.sources.systemAudio) {
    logger.warn('Capture started without system audio (microphone only)');
    sendToRenderer('recording:warning', {
      message: isMac
        ? 'Recording your microphone only: system audio is unavailable. Check Screen & System Audio Recording permission.'
        : 'Recording your microphone only: system audio is unavailable. Check that PulseAudio or PipeWire is running.',
    });
  }
  return true;
}

// The capture window died mid-recording (its renderer crashed). Everything it sent is already
// on disk, so stop the recording there and process what was captured.
function handleCaptureLost(reason: string) {
  if (!isRecording || captureMode !== 'renderer') return;
  logger.error('Recording stopped: the capture window was lost', { reason, sessionId: currentSessionId });
  sendToRenderer('recording:warning', {
    message: 'The recording stopped unexpectedly. What was captured so far is being processed.',
  });
  handleStopRecording();
}

// ── Start / Stop recording ───────────────────────────────────────────────────

// The meeting detection sees right now: the one its prompt offers, else the live one (also after
// "Not now"). Null when detection is off or sees no call.
function detectedMeeting() {
  if (overlayState.mode === 'prompt' && overlayState.meeting) return overlayState.meeting;
  return meetingDetector.activeMeeting();
}

// meetingPlatform: set when recording from the meeting-detection prompt, which knows the platform
// (Google Meet, Zoom, Teams) but rarely the link. Without a link or platform (the app's Record
// button, the tray), the meeting detection sees supplies them (resolveMeetingSource), unless the
// beta setting recordUsesDetectedMeeting is off.
async function handleStartRecording(
  sessionId?: string | null,
  rawUrl?: string | null,
  rawTitle?: string | null,
  rawPlatform?: string | null,
): Promise<RecordingResult> {
  if (isRecording) return { success: false, error: 'Already recording' };

  currentSessionId = sessionId || newSessionId();
  const detected = getConfig().recordUsesDetectedMeeting !== false ? detectedMeeting() : null;
  const { url: meetingUrl, title: meetingTitle, platform: meetingPlatform } = resolveMeetingSource(
    { meetingUrl: rawUrl, meetingTitle: rawTitle, meetingPlatform: rawPlatform },
    detected,
  );

  db.createSession({
    id: currentSessionId,
    title: meetingTitle || 'Untitled Meeting',
    meeting_title: sourceMeetingTitle(meetingTitle),
    meeting_url: meetingUrl || '',
    meeting_platform: meetingPlatform,
    started_at: new Date().toISOString(),
    status: 'recording',
  });

  try {
    // macOS: ask for the microphone up front (no-op once decided). If it's denied the renderer
    // still records system audio alone.
    if (isMac) {
      const { granted } = await requestPermission('microphone');
      if (!granted) logger.warn('Microphone access denied; recording system audio only');
    }

    // Primary: renderer captures system audio (Electron loopback) + mic via Web Audio
    const rendererOk = await requestRendererCaptureStart();

    if (rendererOk) {
      captureMode = 'renderer';
      isRecording = true;
      recordingStartedAt = Date.now();

      // Open write stream so incoming chunks are appended to disk immediately
      const recordingsDir = getRecordingsDir();
      if (!fs.existsSync(recordingsDir)) fs.mkdirSync(recordingsDir, { recursive: true });
      rendererWebmPath = path.join(recordingsDir, `${currentSessionId}.webm`);
      rendererWriteStream = fs.createWriteStream(rendererWebmPath, { flags: 'w' });
      rendererChunkCount = 0;
      rendererBytesWritten = 0;

      updateTrayMenu();
      sendToRenderer('recording:started', { sessionId: currentSessionId });
      broadcastStatus({ type: 'RECORDING_STARTED', sessionId: currentSessionId });
      logger.info('Recording started (renderer capture)', { sessionId: currentSessionId });
      return { success: true, sessionId: currentSessionId };
    }

    // The FFmpeg fallback records through Windows devices (WASAPI loopback / DirectShow) or, on
    // Linux, PulseAudio sources; macOS has none.
    if (isMac) {
      throw new Error(
        'Could not start recording. Check that MeetMind may use the microphone and Screen & System Audio Recording ' +
        '(System Settings → Privacy & Security), then try again.'
      );
    }

    // Fallback: FFmpeg recording (Windows: WASAPI loopback + mic; Linux: default output's monitor + mic)
    logger.info('Renderer capture unavailable, falling back to FFmpeg');
    captureMode = 'ffmpeg';
    await startRecording(currentSessionId);
    isRecording = true;
    recordingStartedAt = Date.now();
    updateTrayMenu();
    sendToRenderer('recording:started', { sessionId: currentSessionId });
    broadcastStatus({ type: 'RECORDING_STARTED', sessionId: currentSessionId });
    logger.info('Recording started (FFmpeg fallback)', { sessionId: currentSessionId });
    return { success: true, sessionId: currentSessionId };
  } catch (err) {
    logger.error('Failed to start recording', { error: errorMessage(err) });
    captureMode = 'none';
    destroyCapture();
    db.updateSession(currentSessionId, { status: 'error', last_error: errorMessage(err) });
    sendToRenderer('recording:error', { error: errorMessage(err) });
    return { success: false, error: errorMessage(err) };
  }
}

async function handleStopRecording(): Promise<RecordingResult> {
  const sessionId = currentSessionId;
  if (!isRecording || !sessionId) return { success: false, error: 'Not recording' };

  try {
    let audioPath: string | undefined;
    const endedAt = new Date().toISOString();
    const recordingsDir = getRecordingsDir();
    if (!fs.existsSync(recordingsDir)) fs.mkdirSync(recordingsDir, { recursive: true });

    if (captureMode === 'renderer') {
      // The capture window flushes its remaining chunks, then is destroyed
      await stopCapture();

      // Close the write stream that has been accumulating chunks
      const stream = rendererWriteStream;
      if (stream) {
        await new Promise<void>((res) => stream.end(res));
        rendererWriteStream = null;
      }

      const webmPath = rendererWebmPath || path.join(recordingsDir, `${sessionId}.webm`);
      const wavPath = path.join(recordingsDir, `${sessionId}.wav`);

      logger.info('Renderer audio saved incrementally, converting to WAV', {
        webmPath,
        chunks: rendererChunkCount,
        bytesWritten: rendererBytesWritten,
      });

      if (fs.existsSync(webmPath) && fs.statSync(webmPath).size > 0) {
        await convertWebmToWav(webmPath, wavPath);
        try { fs.unlinkSync(webmPath); } catch { /* ignore */ }
        audioPath = wavPath;
      } else {
        logger.warn('Renderer webm file is empty or missing', { webmPath });
        if (webmPath && fs.existsSync(webmPath)) {
          try { fs.unlinkSync(webmPath); } catch { /* ignore */ }
        }
      }

      rendererWebmPath = null;
      rendererChunkCount = 0;
      rendererBytesWritten = 0;
    } else {
      audioPath = await stopRecording();
    }

    captureMode = 'none';
    isRecording = false;
    recordingStartedAt = null;

    let durationSeconds: number | null = null;
    try {
      if (audioPath) {
        durationSeconds = probeDurationSeconds(audioPath);
      }
    } catch (err) {
      logger.warn('Failed to compute audio duration from file', {
        sessionId,
        audioPath,
        error: errorMessage(err),
      });
    }

    db.updateSession(sessionId, {
      ended_at: endedAt,
      audio_path: audioPath,
      duration_seconds: durationSeconds,
      status: 'transcribing',
    });

    updateTrayMenu();
    sendToRenderer('recording:stopped', { sessionId, audioPath });
    broadcastStatus({ type: 'RECORDING_STOPPED', sessionId });
    logger.info('Recording stopped', { sessionId, audioPath });

    runProcessingPipeline(sessionId, audioPath);

    return { success: true, sessionId };
  } catch (err) {
    logger.error('Failed to stop recording', { error: errorMessage(err) });
    if (rendererWriteStream) {
      try { rendererWriteStream.end(); } catch { /* ignore */ }
      rendererWriteStream = null;
    }
    rendererWebmPath = null;
    rendererChunkCount = 0;
    rendererBytesWritten = 0;
    captureMode = 'none';
    isRecording = false;
    recordingStartedAt = null;
    destroyCapture();
    db.updateSession(sessionId, {
      status: 'error',
      last_error: errorMessage(err),
      ended_at: new Date().toISOString(),
    });
    return { success: false, error: errorMessage(err) };
  }
}

// True when the session already has a non-empty transcript the pipeline can reuse
// instead of paying for speech-to-text again.
function hasReusableTranscript(session: Session | null) {
  if (!session?.transcript) return false;
  try {
    const parsed = typeof session.transcript === 'string' ? JSON.parse(session.transcript) : session.transcript;
    return Array.isArray(parsed) && parsed.length > 0;
  } catch {
    return false;
  }
}

let activePipelines = 0;   // processing runs in flight; an automatic update install waits for them
// The latest progress and notes preview, so a window opened mid-run shows them (app:state).
let currentProcessing: AppState['processing'] = null;
let currentNotesPreview: NotesPreview | null = null; // the last notes:preview payload

function clearProcessingState(sessionId: string) {
  if (currentProcessing?.sessionId === sessionId) currentProcessing = null;
  if (currentNotesPreview?.sessionId === sessionId) currentNotesPreview = null;
}
// Sessions being processed right now; Settings › Storage never deletes their audio.
const processingSessionIds = new Map<string, number>(); // sessionId → runs in flight

interface ProcessOptions {
  /** Transcribe again even when the meeting already has a transcript. */
  forceRetranscribe?: boolean;
}

async function runProcessingPipeline(sessionId: string, audioPath: string | null | undefined, options: ProcessOptions = {}) {
  activePipelines += 1;
  processingSessionIds.set(sessionId, (processingSessionIds.get(sessionId) || 0) + 1);
  try {
    return await processSession(sessionId, audioPath, options);
  } finally {
    activePipelines -= 1;
    const left = (processingSessionIds.get(sessionId) || 1) - 1;
    if (left > 0) processingSessionIds.set(sessionId, left);
    else processingSessionIds.delete(sessionId);
  }
}

/** Meetings whose audio is in use: the one being recorded and the ones being processed. */
function busySessionIds() {
  const ids = new Set(processingSessionIds.keys());
  if (isRecording && currentSessionId) ids.add(currentSessionId);
  return ids;
}

// Settings › Storage: counts recordings and deletes their audio, keeping notes and transcripts.
const recordingsStorage = createRecordingsStorage({ getRecordingsDir, db, deleteSessionWaveform, logger });

/** Deletes recordings older than the "Keep recordings" setting. Runs at startup and on request. */
function runRetentionCleanup(reason: string) {
  const { recordingRetentionDays } = getConfig();
  return recordingsStorage.cleanup({ retentionDays: recordingRetentionDays, busyIds: busySessionIds(), reason });
}

async function processSession(sessionId: string, audioPath: string | null | undefined, options: ProcessOptions = {}) {
  const sendProgress: SendProgress = (stage, percent) => {
    if (stage !== 'complete') currentProcessing = { sessionId, stage, percent };
    sendToRenderer('processing:progress', { stage, percent });
    broadcastStatus({ type: 'PROCESSING_PROGRESS', stage, percent, sessionId });
  };

  // Abort guard — called before each expensive stage so a session deleted
  // mid-pipeline doesn't burn API calls on transcription, LLM, or Notion.
  function abortIfCancelled() {
    if (cancelledSessions.has(sessionId) || !db.getSession(sessionId)) {
      cancelledSessions.delete(sessionId);
      throw Object.assign(new Error('Session deleted while processing'), { _cancelled: true });
    }
  }

  // Start on the next tick so an IPC handler's reply reaches the renderer before any progress or
  // error event. Otherwise a run that fails at once (e.g. a missing API key) sends
  // processing:error before the caller starts tracking it, and the UI stays stuck "processing".
  await new Promise((resolve) => setImmediate(resolve));

  try {
    abortIfCancelled();

    const config = getConfig();
    const session = db.getSession(sessionId);
    let transcript: TranscriptSegment[] | null = null;
    let sttInfo = { provider: config.sttService || 'google', model: config.sttModels?.[config.sttService] || '' };

    // Check if transcript already exists for this session unless forceRetranscribe is true
    if (!options?.forceRetranscribe && session && session.transcript) {
      try {
        const parsed = typeof session.transcript === 'string' ? JSON.parse(session.transcript) : session.transcript;
        if (Array.isArray(parsed) && parsed.length > 0) {
          transcript = parsed;
          logger.info('Reusing existing transcript for session', { sessionId, segments: transcript.length });
        }
      } catch (e) {
        logger.warn('Failed to parse existing transcript, will re-transcribe', { sessionId, error: errorMessage(e) });
      }
    }

    if (!transcript) {
      // Stage 1: Transcription (0–60%)
      sendProgress('transcribing', 0);
      const onTranscriptionProgress = (pct: number) => sendProgress('transcribing', Math.round(pct * 0.6));
      const stt = await transcribe(String(audioPath), config, onTranscriptionProgress);
      transcript = stt.segments;
      sttInfo = { provider: stt.provider, model: stt.model };

      // transcribe() throws for silent files; if we get here but with empty results,
      // treat it the same way (STT may return empty for near-silence)
      if (!transcript || transcript.length === 0) {
        throw new Error(`No speech detected in the recording. ${silenceHints(process.platform).join(' ')}`);
      }

      abortIfCancelled();
      db.updateSession(sessionId, { transcript: JSON.stringify(transcript), status: 'generating' });
    } else {
      db.updateSession(sessionId, { status: 'generating' });
    }

    sendProgress('generating', NOTES_PROGRESS_START);

    abortIfCancelled();

    // Stage 2: LLM notes (60–85%)
    // Read fresh: the meeting may have been renamed while it was being transcribed.
    const notes = await generateAndStampNotes(sessionId, transcript, config, sttInfo, db.getSession(sessionId)?.meeting_title, sendProgress);

    abortIfCancelled();
    // ...or while the notes were being written.
    applyMeetingTitle(notes, db.getSession(sessionId)?.meeting_title);

    db.updateSession(sessionId, {
      notes: JSON.stringify(notes),
      title: notes.meeting_title || notes.title || 'Untitled Meeting',
      status: 'complete',
      last_error: null,
    });
    sendProgress('complete', 85);

    // Stage 3: Notion upload (85–100%) — optional, only if configured
    let notionUrl: string | null = null;
    if (config.notionToken && config.notionPageId) {
      abortIfCancelled();
      sendProgress('uploading', 85);
      db.updateSession(sessionId, { status: 'uploading' });
      notionUrl = await uploadSessionToNotion(sessionId, notes, transcript, config);
      db.updateSession(sessionId, { notion_page_url: notionUrl, status: 'complete' });
      sendProgress('complete', 100);
    }

    clearProcessingState(sessionId);

    sendToRenderer('processing:complete', { sessionId, notionUrl });
    broadcastStatus({ type: 'PROCESSING_COMPLETE', notionUrl, sessionId });
    logger.info('Processing pipeline complete', { sessionId, notionUrl });
  } catch (err) {
    // If the session was deleted, silently drop the pipeline — no error toast,
    // no status update (the row is already gone).
    if (isPipelineCancelled(err) || cancelledSessions.has(sessionId) || !db.getSession(sessionId)) {
      cancelledSessions.delete(sessionId);
      logger.info('Processing pipeline cancelled (session deleted)', { sessionId });
      clearProcessingState(sessionId);
      sendToRenderer('processing:cancelled', { sessionId });
      syncOverlayWithStatus({ type: 'PROCESSING_CANCELLED', sessionId });
      return;
    }
    logger.error('Processing pipeline error', { sessionId, error: errorMessage(err) });
    db.updateSession(sessionId, { status: 'error', last_error: errorMessage(err) });
    clearProcessingState(sessionId);
    sendToRenderer('processing:error', { sessionId, error: errorMessage(err) });
    broadcastStatus({ type: 'PROCESSING_ERROR', error: errorMessage(err), sessionId });
  }
}

// ── Meeting overlay ──────────────────────────────────────────────────────────
// One state object drives the floating overlay (electron/overlay/overlay-window.ts). Native
// meeting detection opens it with a "Start recording" prompt; recording and processing status
// keep it in step, whichever surface (overlay, app, tray or extension) started the recording.

let overlayState: OverlayState = { mode: 'hidden' };
let overlayHideTimer: ReturnType<typeof setTimeout> | undefined;
const PROMPT_TIMEOUT_MS = 2 * 60 * 1000;   // an unanswered "Meeting detected" prompt counts as "Not now"
let meetingToast: MeetingToast | null = null;   // the fallback notification for a prompt the overlay couldn't show

function isMeetingDetectionEnabled() {
  return getConfig().meetingDetection !== false;
}

// `onAutoHide` replaces the default hide when `autoHideMs` runs out.
function setOverlay(next: OverlayState, { autoHideMs, onAutoHide }: { autoHideMs?: number; onAutoHide?: () => void } = {}) {
  clearTimeout(overlayHideTimer);
  overlayState = next;
  if (meetingToast && (next.mode !== 'prompt' || next.meeting?.key !== meetingToast.meetingKey)) closeMeetingToast();
  if (next.mode === 'hidden' || !isMeetingDetectionEnabled()) {
    hideOverlay();
    return;
  }
  showOverlay(overlayState, {
    theme: resolveEffectiveTheme(getConfig().theme || 'light'),
    bounds: next.meeting?.bounds || null,
  });
  if (autoHideMs) {
    overlayHideTimer = setTimeout(onAutoHide || (() => setOverlay({ ...overlayState, mode: 'hidden' })), autoHideMs);
  }
}

// Mirrors a recording/processing status message onto the overlay. Processing updates only
// apply to the session the overlay is following, so retrying an old meeting never pops it up.
function syncOverlayWithStatus(message: StatusMessage) {
  const following = message.sessionId && message.sessionId === overlayState.sessionId;
  switch (message.type) {
    case 'RECORDING_STARTED':
      setOverlay({
        mode: 'recording',
        meeting: overlayState.mode === 'prompt' ? overlayState.meeting : meetingDetector.activeMeeting(),
        sessionId: message.sessionId,
        startedAt: Date.now(),
      });
      break;
    case 'RECORDING_STOPPED':
      if (following) setOverlay({ ...overlayState, mode: 'processing', stage: 'transcribing', percent: 0 });
      break;
    case 'PROCESSING_PROGRESS':
      if (following && overlayState.mode === 'processing') {
        setOverlay({ ...overlayState, stage: message.stage, percent: message.percent });
      }
      break;
    case 'PROCESSING_COMPLETE':
      if (following && overlayState.mode === 'processing') {
        setOverlay({ ...overlayState, mode: 'complete', percent: 100, notionUrl: message.notionUrl || null }, { autoHideMs: 10000 });
      }
      break;
    case 'PROCESSING_ERROR':
      if (following && overlayState.mode === 'processing') {
        setOverlay({ ...overlayState, mode: 'error', error: message.error }, { autoHideMs: 8000 });
      }
      break;
    case 'PROCESSING_CANCELLED':
      if (following) setOverlay({ mode: 'hidden' });
      break;
    default:
      break;
  }
}

// Sends a status message to the Chrome extension and mirrors it on the desktop overlay.
function broadcastStatus(message: StatusMessage) {
  broadcastToExtension(message);
  syncOverlayWithStatus(message);
}

function handleMeetingDetected(meeting: DetectedMeeting) {
  if (isRecording) {
    // Already recording (started some other way): just label the overlay with the meeting.
    if (!overlayState.meeting) setOverlay({ ...overlayState, meeting });
    return;
  }
  setOverlay({ mode: 'prompt', meeting }, {
    autoHideMs: PROMPT_TIMEOUT_MS,
    onAutoHide: () => {
      logger.info('Meeting prompt unanswered for 2 minutes; closed as "Not now"', { key: meeting.key });
      dismissPrompt();
    },
  });
}

// "Not now" (or an unanswered prompt): close it, and don't prompt for this meeting until it ends.
function dismissPrompt() {
  if (overlayState.mode === 'prompt' && overlayState.meeting?.key) meetingDetector.dismiss(overlayState.meeting.key);
  setOverlay({ ...overlayState, mode: 'hidden' });
}

// Never stops on its own: while recording, ask; while only prompting, withdraw the prompt.
function handleMeetingEnded(meeting: DetectedMeeting) {
  if (isRecording) {
    setOverlay({ ...overlayState, mode: 'ended' });
  } else if (overlayState.mode === 'prompt' && overlayState.meeting?.key === meeting.key) {
    setOverlay({ mode: 'hidden' });
  }
}

function closeMeetingToast() {
  const toast = meetingToast;
  meetingToast = null;
  toast?.close();
}

// The overlay couldn't be shown even after a retry: offer the recording as a system notification
// instead, so a detected meeting is never silently missed. Clicking it does what Record does.
function showMeetingToast(meeting: DetectedMeeting) {
  closeMeetingToast();
  if (!Notification.isSupported()) {
    logger.warn('Meeting overlay failed and notifications are unsupported; no prompt shown', { key: meeting.key });
    return;
  }
  const toast: MeetingToast = new Notification({
    title: 'Meeting detected',
    body: `${meeting.title || meeting.platformLabel || 'A meeting'} · Click to start recording`,
    icon: nativeImage.createFromPath(path.join(appRoot, 'assets/icons/icon.png')),
  });
  toast.meetingKey = meeting.key;
  toast.on('click', () => {
    if (meetingToast === toast) meetingToast = null;
    if (isRecording || overlayState.mode !== 'prompt' || overlayState.meeting?.key !== meeting.key) {
      logger.info('Meeting notification clicked after the prompt ended; ignored', { key: meeting.key });
      return;
    }
    logger.info('Recording started from the meeting notification', { key: meeting.key });
    handleStartRecording(null, meeting.url || '', meeting.title || '', meeting.platform);
  });
  toast.on('failed', (_e, error) => logger.warn('Meeting notification failed', { error }));
  meetingToast = toast;
  toast.show();
  logger.info('Meeting overlay unavailable; showed a notification instead', { key: meeting.key });
}

function handleOverlayFailure(state: OverlayState, reason: string) {
  if (state.mode === 'prompt' && state.meeting && isMeetingDetectionEnabled()) {
    showMeetingToast(state.meeting);
  } else {
    logger.warn('Meeting overlay unavailable', { mode: state.mode, reason });
  }
}

function applyMeetingDetection(enabled: boolean) {
  if (enabled) {
    meetingDetector.start({ onDetected: handleMeetingDetected, onEnded: handleMeetingEnded });
  } else {
    meetingDetector.stop();
    setOverlay({ mode: 'hidden' });
  }
}

// ── Main window support ──────────────────────────────────────────────────────

let logSubscribed = false;   // the Logs page is open and listening for log:entry

// At most this many renderer errors are logged per minute: a render loop can throw thousands.
const RENDERER_ERRORS_PER_MINUTE = 20;
let rendererErrorWindowStart = 0;
let rendererErrorCount = 0;

function logRendererError(report: RendererErrorReport) {
  const now = Date.now();
  if (now - rendererErrorWindowStart > 60000) {
    rendererErrorWindowStart = now;
    rendererErrorCount = 0;
  }
  rendererErrorCount += 1;
  if (rendererErrorCount > RENDERER_ERRORS_PER_MINUTE) return;
  const text = (value: unknown) => (typeof value === 'string' ? value.slice(0, 4000) : undefined);
  const r: RendererErrorReport = report && typeof report === 'object' ? report : {};
  logger.error('Renderer error', {
    kind: text(r.kind),
    message: text(r.message),
    boundary: text(r.boundary),
    source: text(r.source),
    stack: text(r.stack),
    componentStack: text(r.componentStack),
  });
  if (rendererErrorCount === RENDERER_ERRORS_PER_MINUTE) {
    logger.warn('Too many renderer errors; not logging more for a minute');
  }
}

// The window could not be repaired by a reload or by replacing it. Say so instead of leaving a
// blank window; a recording runs in its own window and is not affected.
async function handleMainWindowGiveUp(reason: string) {
  logger.error('Main window could not be repaired', { reason, recording: isRecording });
  const canRestart = !isRecording && activePipelines === 0;
  const { response } = await dialog.showMessageBox({
    type: 'error',
    title: 'MeetMind',
    message: 'MeetMind couldn’t display its window',
    detail: canRestart
      ? 'Restarting MeetMind usually fixes this. Your meetings and recordings are safe.'
      : 'Your recording and any notes being written continue in the background. Restart MeetMind once they are done.',
    buttons: canRestart ? ['Restart MeetMind', 'Not now'] : ['OK'],
    defaultId: 0,
    cancelId: canRestart ? 1 : 0,
  });
  if (canRestart && response === 0) {
    app.relaunch();
    app.isQuitting = true;
    app.quit();
  }
}

// ── IPC Handlers ─────────────────────────────────────────────────────────────

// A file or folder picker, attached to the main window when there is one.
function showOpenDialog(options: OpenDialogOptions) {
  const win = getMainWindow();
  return win ? dialog.showOpenDialog(win, options) : dialog.showOpenDialog(options);
}

function registerIpcHandlers() {
  // ── Main window (window:* IPC lives in window/main-window.ts) ─────────────
  registerMainWindowIpc({
    getTheme: () => getConfig().theme || 'light',
    getBackgroundColor: resolveStartupBackgroundColor,
    getIconPath: getAppIconPath,
    onCreated: () => { logSubscribed = false; },
    onGiveUp: handleMainWindowGiveUp,
  });

  // What a newly created (or reloaded) window needs to pick up where things are: the recording
  // and processing run in main, and the page it last showed.
  ipc.handle('app:state', () => ({
    recording: isRecording ? { sessionId: currentSessionId, startedAt: recordingStartedAt } : null,
    processing: currentProcessing,
    notesPreview: currentNotesPreview,
    view: getViewState(),
  }));

  // Errors from the renderer (render errors caught by a boundary, uncaught errors, unhandled
  // rejections) go to the log file; they used to be visible only in DevTools.
  ipc.on('renderer:error', (_e, report) => logRendererError(report));

  // Open a URL in the OS default browser (safe: only http/https allowed)
  ipc.handle('shell:open-external', (_e, url) => {
    if (typeof url === 'string' && (url.startsWith('http://') || url.startsWith('https://'))) {
      return shell.openExternal(url);
    }
  });

  // ── Logs ──────────────────────────────────────────────────────────────────
  ipc.handle('logs:get', (_e, { limit } = {}) => logger.readLogs(limit));
  ipc.handle('logs:clear', () => logger.clearLogs());
  ipc.handle('logs:openFolder', () => shell.openPath(logger.getLogsDir()));
  // Live log lines are pushed only while the Logs page is listening for them.
  ipc.on('logs:subscribe', (event) => {
    if (event.sender === getMainWindow()?.webContents) logSubscribed = true;
  });
  ipc.on('logs:unsubscribe', () => { logSubscribed = false; });
  logger.setLogEmitter((entry) => {
    if (logSubscribed) sendToRenderer('log:entry', entry);
  });

  // Calendar sources hold credentials (ICS links, OAuth secrets and tokens); the renderer reads
  // them redacted through calendar:list and changes them only through the calendar:* handlers.
  ipc.handle('config:get', () => {
    const { calendars: _calendars, ...config } = getConfig();
    return config;
  });

  ipc.handle('config:autoLaunchStatus', () => autoLaunch.getStatus());

  ipc.handle('config:set', (_e, key, value) => {
    if (key === 'calendars') return false;
    setConfig(key, value);
    if (key === 'calendarSyncMinutes') sendToRenderer('calendar:changed');
    if (key === 'autoLaunch') {
      autoLaunch.set(value);
    }
    if (key === 'meetingDetection') applyMeetingDetection(value !== false);
    if (key === 'theme') setOverlayTheme(resolveEffectiveTheme(value));
    if (key === 'macCaptureStrategy') installDisplayMediaHandler();
    if (key === 'autoCheckUpdates' || key === 'autoInstallUpdates') applyUpdateSettings();
    return true;
  });

  ipc.handle('config:set-multiple', (_e, { calendars: _calendars, ...updates }) => {
    setMultipleConfig(updates);
    if ('autoLaunch' in updates) {
      autoLaunch.set(updates.autoLaunch);
    }
    if ('meetingDetection' in updates) applyMeetingDetection(updates.meetingDetection !== false);
    if ('theme' in updates) setOverlayTheme(resolveEffectiveTheme(updates.theme));
    if ('macCaptureStrategy' in updates) installDisplayMediaHandler();
    if ('autoCheckUpdates' in updates || 'autoInstallUpdates' in updates) applyUpdateSettings();
    return true;
  });

  // ── macOS permissions + system-audio test (Settings › System) ─────────────
  ipc.handle('permissions:status', () => getPermissionStatus());
  ipc.handle('permissions:request', (_e, kind) => requestPermission(kind));
  ipc.handle('permissions:open-settings', (_e, kind) => openPermissionSettings(kind));

  // "Test system audio" runs one short renderer capture per strategy: main swaps the
  // display-media handler to that strategy for the test, then restores the configured one.
  ipc.handle('capture:test-begin', (_e, strategy) => {
    if (isRecording) return { success: false, error: 'Stop the current recording first' };
    testCaptureStrategy = normalizeMacCaptureStrategy(strategy);
    installDisplayMediaHandler();
    return { success: true, strategy: testCaptureStrategy };
  });
  ipc.handle('capture:test-end', () => {
    testCaptureStrategy = null;
    installDisplayMediaHandler();
    return true;
  });

  ipc.handle('recording:start', (_e, sessionId, meetingUrl, meetingTitle) =>
    handleStartRecording(sessionId, meetingUrl, meetingTitle)
  );

  ipc.handle('recording:stop', () => handleStopRecording());

  // ── Meeting overlay ───────────────────────────────────────────────────────
  // overlay:ready / shown / closed / resize / move belong to the window itself (overlay-window.ts).
  registerOverlayIpc({ onFailure: handleOverlayFailure });

  ipc.handle('overlay:start', () => {
    if (overlayState.mode !== 'prompt') return { success: false, error: 'Nothing to record' };
    const meeting = overlayState.meeting;
    return handleStartRecording(null, meeting?.url || '', meeting?.title || '', meeting?.platform);
  });

  ipc.handle('overlay:stop', () => handleStopRecording());

  ipc.handle('overlay:dismiss', () => {
    dismissPrompt();
    return true;
  });

  ipc.handle('overlay:keep-recording', () => {
    if (isRecording && overlayState.mode === 'ended') setOverlay({ ...overlayState, mode: 'recording' });
    return true;
  });

  ipc.handle('overlay:open-session', (_e, sessionId) => {
    focusMainWindow();
    if (typeof sessionId === 'string' && sessionId) sendToRendererQueued('app:open-session', { sessionId });
    setOverlay({ ...overlayState, mode: 'hidden' });
    return true;
  });

  // ── Capture window (audio/capture-window.ts) ──────────────────────────────
  registerCaptureIpc({
    // Each chunk is appended to the in-progress .webm as it arrives.
    onChunk: (buffer) => {
      if (!rendererWriteStream) return;   // a chunk still in flight after the recording stopped
      try {
        const chunk = buffer instanceof ArrayBuffer ? Buffer.from(buffer) : Buffer.from(buffer);
        rendererWriteStream.write(chunk);
        rendererChunkCount++;
        rendererBytesWritten += chunk.length;
      } catch (err) {
        logger.error('Failed to write audio chunk to disk', { error: errorMessage(err) });
      }
    },
    // Live meters: only worth sending while someone can see them.
    onLevels: (levels) => {
      if (isMainWindowVisible()) sendToRenderer('recording:levels', levels);
    },
    onLost: handleCaptureLost,
  });

  // FFmpeg device capture (the recording fallback) uses Windows or Linux (PulseAudio) devices.
  const FFMPEG_DEVICES_UNSUPPORTED = 'FFmpeg device capture is only available on Windows and Linux';
  ipc.handle('audio:list-devices', () => (isMac ? { all: [], system: null, mic: null, error: FFMPEG_DEVICES_UNSUPPORTED } : listAudioDevices()));

  ipc.handle('audio:probe-device', (_e, device) => (isMac ? { device, peak: 0, isSilent: true, error: FFMPEG_DEVICES_UNSUPPORTED } : probeAudioDevice(device)));

  // Settings › System › System audio (Linux): the audio server MeetMind records from, and whether
  // the FFmpeg fallback can record from it.
  ipc.handle('audio:linux-status', async () => {
    if (!isLinux) return { error: 'Linux only' };
    let info: Awaited<ReturnType<typeof pulseInfo>> | null = null;
    let error: string | null = null;
    try { info = await pulseInfo(); } catch (err) { error = errorMessage(err); }
    return {
      server: info?.serverName || null,
      defaultSink: info?.defaultSink || null,
      defaultSource: info?.defaultSource || null,
      ffmpegPulse: ffmpegSupportsPulse(),
      error,
    };
  });

  ipc.handle('audio:import-file', async () => {
    const { canceled, filePaths } = await showOpenDialog({
      title: 'Select audio file',
      properties: ['openFile'],
      filters: [
        {
          name: 'Audio/Video files',
          extensions: ['wav', 'mp3', 'm4a', 'aac', 'flac', 'ogg', 'opus', 'webm', 'mp4', 'mkv', 'mov'],
        },
      ],
    });

    if (canceled || !filePaths || filePaths.length === 0) {
      return { success: false, cancelled: true };
    }

    const srcPath = filePaths[0];

    try {
      const sessionId = newSessionId();

      const recordingsDir = getRecordingsDir();
      if (!fs.existsSync(recordingsDir)) {
        fs.mkdirSync(recordingsDir, { recursive: true });
      }

      const ext = path.extname(srcPath).toLowerCase();
      const destPath = path.join(recordingsDir, `${sessionId}.wav`);

      if (ext === '.wav') {
        fs.copyFileSync(srcPath, destPath);
      } else {
        await convertFileToWav(srcPath, destPath);
      }

      let durationSeconds: number | null = null;
      try {
        durationSeconds = probeDurationSeconds(destPath);
      } catch (err) {
        logger.warn('Failed to compute duration for imported audio', {
          srcPath,
          destPath,
          error: errorMessage(err),
        });
      }

      db.createSession({
        id: sessionId,
        title: path.basename(srcPath, ext) || 'Imported audio',
        meeting_url: '',
        started_at: new Date().toISOString(),
        audio_path: destPath,
        duration_seconds: durationSeconds,
        status: 'transcribing',
      });

      runProcessingPipeline(sessionId, destPath);

      return { success: true, sessionId };
    } catch (err) {
      logger.error('Audio import failed', { error: errorMessage(err) });
      return { success: false, error: errorMessage(err) };
    }
  });

  ipc.handle('sessions:list', () => db.listSessions());
  // Cheap check before sessions:list, which copies every transcript to the renderer.
  ipc.handle('sessions:revision', () => db.getRevision());

  ipc.handle('session:get', (_e, id) => db.getSession(id));

  ipc.handle('session:delete', (_e, id) => {
    // If the processing pipeline is in flight for this session, flag it for
    // abort so it doesn't keep burning API calls after the row is gone.
    cancelledSessions.add(id);
    setTimeout(() => cancelledSessions.delete(id), 5 * 60 * 1000);
    db.deleteSession(id);
    deleteSessionWaveform(id);

    // Clean up the audio file — it's no longer needed.
    try {
      const recordingsDir = getRecordingsDir();
      for (const ext of ['.wav', '.webm']) {
        const fp = path.join(recordingsDir, `${id}${ext}`);
        if (fs.existsSync(fp)) fs.unlinkSync(fp);
      }
    } catch (err) {
      logger.warn('Failed to clean up audio files for deleted session', { sessionId: id, error: errorMessage(err) });
    }

    return true;
  });

  // Saves notes edited in the renderer (already parsed from Markdown there).
  ipc.handle('session:update-notes', (_e, id, notes) => {
    const session = db.getSession(id);
    if (!session) return { success: false, error: 'Meeting not found.' };
    if (!notes || typeof notes !== 'object' || Array.isArray(notes)) {
      return { success: false, error: 'Invalid notes.' };
    }
    try {
      db.updateSession(id, {
        notes: JSON.stringify(notes),
        title: notes.meeting_title || notes.title || session.title,
      });
      logger.info('Notes edited', { sessionId: id });
      const updated = db.getSession(id);
      if (!updated) return { success: false, error: 'Meeting not found.' };
      return { success: true, session: updated };
    } catch (err) {
      logger.error('Failed to save edited notes', { sessionId: id, error: errorMessage(err) });
      return { success: false, error: errorMessage(err) || 'Failed to save notes.' };
    }
  });

  // Renames a meeting from its page. The new name becomes the meeting's own title, so notes
  // regenerated later keep it instead of taking the LLM's.
  ipc.handle('session:rename', (_e, id, rawTitle) => {
    const session = db.getSession(id);
    if (!session) return { success: false, error: 'Meeting not found.' };
    const title = cleanTitle(rawTitle);
    if (!title) return { success: false, error: 'The title can’t be empty.' };
    try {
      const updates: SessionUpdate = { title, meeting_title: title };
      if (session.notes && typeof session.notes === 'object') {
        updates.notes = JSON.stringify(applyMeetingTitle(session.notes, title));
      }
      db.updateSession(id, updates);
      logger.info('Meeting renamed', { sessionId: id });
      const updated = db.getSession(id);
      if (!updated) return { success: false, error: 'Meeting not found.' };
      return { success: true, session: updated };
    } catch (err) {
      logger.error('Failed to rename meeting', { sessionId: id, error: errorMessage(err) });
      return { success: false, error: errorMessage(err) || 'Failed to rename the meeting.' };
    }
  });

  ipc.handle('session:open-recording', async (_e, sessionId) => {
    const audioPath = resolveSessionAudioPath(sessionId);
    if (!audioPath) {
      return { success: false, error: 'Recording file not found for this session.' };
    }
    try {
      shell.showItemInFolder(audioPath);
      return { success: true, path: audioPath };
    } catch (err) {
      logger.error('Failed to open recording file', { sessionId, audioPath, error: errorMessage(err) });
      return { success: false, error: errorMessage(err) || 'Failed to open recording file.' };
    }
  });

  // Loudness envelope for the Audio tab's waveform player.
  ipc.handle('session:waveform', async (_e, sessionId) => {
    const audioPath = resolveSessionAudioPath(sessionId);
    if (!audioPath) {
      return { success: false, error: 'Recording file not found for this session.' };
    }
    try {
      const { peaks, duration } = await getSessionWaveform(sessionId, audioPath);
      return { success: true, peaks, duration };
    } catch (err) {
      logger.warn('Failed to compute waveform', { sessionId, audioPath, error: errorMessage(err) });
      return { success: false, error: errorMessage(err) || 'Failed to compute waveform.' };
    }
  });

  // Whether a meeting's Audio tab can play something, and if not, why.
  // bytes/format describe the file that plays; busy is true while it's being recorded or processed.
  ipc.handle('session:audio-status', (_e, sessionId) => {
    const session = db.getSession(sessionId);
    if (!session) return { available: false, deletedAt: null, source: null, bytes: null, format: null, busy: false };
    const audioPath = resolveSessionAudioPath(sessionId);
    let bytes: number | null = null;
    if (audioPath) {
      try {
        bytes = fs.statSync(audioPath).size;
      } catch {
        // Gone since it was resolved.
      }
    }
    return {
      available: !!audioPath,
      deletedAt: session.audio_deleted_at || null,
      source: session.source || null,
      bytes,
      format: audioPath ? path.extname(audioPath).slice(1).toUpperCase() || null : null,
      busy: busySessionIds().has(sessionId),
    };
  });

  // Deletes one meeting's recording from its Audio tab, keeping its notes and transcript.
  ipc.handle('session:delete-recording', (_e, sessionId) => {
    try {
      return recordingsStorage.deleteOne({ id: sessionId, busyIds: busySessionIds() });
    } catch (err) {
      logger.error('Deleting a recording failed', { sessionId, error: errorMessage(err) });
      return { success: false, error: errorMessage(err) || 'Couldn’t delete the recording.' };
    }
  });

  // ── Recording storage (Settings › Storage) ─────────────────────────────────
  // retentionDays previews a "Keep recordings" choice that isn't saved yet.
  ipc.handle('storage:summary', (_e, retentionDays) => {
    const days = retentionDays === undefined ? getConfig().recordingRetentionDays : retentionDays;
    return recordingsStorage.getSummary({ retentionDays: days, busyIds: busySessionIds() });
  });

  ipc.handle('storage:cleanup', () => {
    try {
      return { success: true, ...runRetentionCleanup('manual') };
    } catch (err) {
      logger.error('Recording cleanup failed', { error: errorMessage(err) });
      return { success: false, error: errorMessage(err) };
    }
  });

  ipc.handle('storage:delete-all', () => {
    try {
      return { success: true, ...recordingsStorage.deleteAll({ busyIds: busySessionIds() }) };
    } catch (err) {
      logger.error('Deleting all recordings failed', { error: errorMessage(err) });
      return { success: false, error: errorMessage(err) };
    }
  });

  ipc.handle('storage:open-folder', async () => {
    const dir = getRecordingsDir();
    try {
      fs.mkdirSync(dir, { recursive: true });
      const error = await shell.openPath(dir);
      return error ? { success: false, error } : { success: true };
    } catch (err) {
      return { success: false, error: errorMessage(err) };
    }
  });

  // ── Folder picker (shared) ─────────────────────────────────────────────────
  ipc.handle('dialog:choose-folder', async (_e, opts = {}) => {
    const result = await showOpenDialog({
      title: typeof opts.title === 'string' ? opts.title : 'Choose a folder',
      defaultPath: typeof opts.defaultPath === 'string' ? opts.defaultPath : undefined,
      properties: ['openDirectory', 'createDirectory'],
    });
    if (result.canceled || !result.filePaths?.[0]) return { cancelled: true };
    return { path: result.filePaths[0] };
  });

  // ── PDF export ─────────────────────────────────────────────────────────────
  ipc.handle('pdf:default-dir', () => app.getPath('downloads'));

  // The renderer builds the HTML (so notes render exactly as in the app); the file name
  // and folder are decided here so they have one source of truth.
  ipc.handle('pdf:export', async (_e, sessionId, html) => {
    const session = db.getSession(sessionId);
    if (!session) return { success: false, error: 'Session not found' };
    if (typeof html !== 'string' || !html.trim()) return { success: false, error: 'Nothing to export yet.' };

    let notes: Notes = {};
    try {
      notes = typeof session.notes === 'string' ? JSON.parse(session.notes || '{}') : (session.notes || {});
    } catch { /* fall back to the session title */ }
    const title = notes?.meeting_title || notes?.title || session.title || 'Meeting Notes';
    const config = getConfig();
    return exportPdf({
      html,
      fileName: buildPdfFileName(session.started_at, title),
      dir: resolveExportDir(config.pdfExportDir),
    });
  });

  ipc.handle('pdf:reveal', (_e, filePath) => {
    if (typeof filePath !== 'string' || !filePath.toLowerCase().endsWith('.pdf') || !fs.existsSync(filePath)) {
      return { success: false, error: 'File not found.' };
    }
    shell.showItemInFolder(filePath);
    return { success: true };
  });

  ipc.handle('notion:upload', async (_e, sessionId) => {
    const session = db.getSession(sessionId);
    if (!session) return { success: false, error: 'Session not found' };

    const config = getConfig();
    if (!config.notionToken || !config.notionPageId) {
      return { success: false, error: 'Notion not configured — add your token and parent page ID in Settings.' };
    }

    try {
      const notes =
        typeof session.notes === 'string'
          ? JSON.parse(session.notes || '{}')
          : (session.notes || {});
      const transcript =
        typeof session.transcript === 'string'
          ? JSON.parse(session.transcript || '[]')
          : (session.transcript || []);
      const url = await uploadSessionToNotion(sessionId, notes, transcript, config);
      db.updateSession(sessionId, { notion_page_url: url });
      return { success: true, url };
    } catch (err) {
      logger.error('Notion upload failed', { error: errorMessage(err) });
      return { success: false, error: errorMessage(err) };
    }
  });

  ipc.handle('notion:test', async (_e, token, pageId) => {
    try {
      const res = await testNotionConnection(pageId, token);
      return { ...res, success: true };
    } catch (err) {
      return { success: false, error: errorMessage(err) };
    }
  });

  ipc.handle('providers:list', () => describeProviders());

  // Generic connection test for any registered provider. `values` are the (possibly unsaved)
  // form values, so credentials can be verified before saving.
  ipc.handle('providers:test', async (_e, { kind, id, values, model }) => {
    try {
      const registry = registries[kind];
      if (!registry) throw new Error(`Unknown provider kind "${kind}"`);
      const provider = registry.get(id);
      const config = { ...getConfig(), ...(values || {}) };
      if (!registry.isConfigured(provider, config)) {
        const missing = provider.credentials.find((f) => f.required && !String((config as Record<string, unknown>)[f.configKey] ?? '').trim());
        throw new Error(`${missing?.label || 'Credentials'} is required`);
      }
      await provider.test({ config, model: registry.resolveModel(provider, model) });
      return { success: true };
    } catch (err) {
      return { success: false, error: errorMessage(err) };
    }
  });

  ipc.handle('gemini:default-system-prompt', () => DEFAULT_SYSTEM_PROMPT);

  ipc.handle('gemini:default-md-system-prompt', () => DEFAULT_MD_SYSTEM_PROMPT);

  ipc.handle('processing:run', async (_e, sessionId) => {
    const session = db.getSession(sessionId);
    // A saved transcript is enough (e.g. pasted transcripts have no audio).
    if (!session || (!session.audio_path && !hasReusableTranscript(session))) {
      return { success: false, error: 'No audio file found for session' };
    }
    runProcessingPipeline(sessionId, session.audio_path);
    return { success: true };
  });

  ipc.handle('processing:retry', async (_e, sessionId, stage) => {
    const session = db.getSession(sessionId);
    if (!session) return { success: false, error: 'Session not found' };

    // 'notes' and 'all' reuse the saved transcript when there is one, so a retry only re-runs
    // the stages that failed; speech-to-text runs again only if no usable transcript exists.
    // 'transcription' is the explicit "re-transcribe from the audio" request.
    if (stage === 'notes' || stage === 'all') {
      if (!session.audio_path && !hasReusableTranscript(session)) {
        return { success: false, error: 'No audio file or transcript found for session' };
      }
      runProcessingPipeline(sessionId, session.audio_path, { forceRetranscribe: false });
      return { success: true };
    }
    if (stage === 'transcription') {
      if (!session.audio_path) return { success: false, error: 'No audio file found for session' };
      runProcessingPipeline(sessionId, session.audio_path, { forceRetranscribe: true });
      return { success: true };
    }
    if (stage === 'notion') {
      const config = getConfig();
      try {
        const notes =
          typeof session.notes === 'string'
            ? JSON.parse(session.notes || '{}')
            : (session.notes || {});
        const transcript =
          typeof session.transcript === 'string'
            ? JSON.parse(session.transcript || '[]')
            : (session.transcript || []);
        const url = await uploadSessionToNotion(sessionId, notes, transcript, config);
        db.updateSession(sessionId, { notion_page_url: url, status: 'complete' });
        return { success: true, url };
      } catch (err) {
        return { success: false, error: errorMessage(err) };
      }
    }
    return { success: false, error: 'Unknown stage' };
  });

  // Create a session from a pasted transcript (skip STT, go straight to note generation)
  ipc.handle('session:create-from-transcript', async (_e, { title, transcriptText }) => {
    if (!transcriptText || !transcriptText.trim()) {
      return { success: false, error: 'Transcript text is empty.' };
    }

    const config = getConfig();
    const llm = registries.llm.get(config.llmProvider);
    if (!registries.llm.isConfigured(llm, config)) {
      return { success: false, error: `${llm.name} API key is not configured. Please add it in Settings.` };
    }

    const sessionId = newSessionId();
    const now = new Date().toISOString();

    // Convert raw text into the standard segment array expected by generateNotes and NoteViewer.
    // Split on blank lines (paragraph boundaries); each paragraph becomes one segment.
    const paragraphs = transcriptText
      .split(/\n\s*\n/)
      .map((p) => p.trim())
      .filter(Boolean);

    const transcript = paragraphs.map((text, i) => ({
      speaker:        'Speaker',
      text,
      start_time:     i * 5,   // synthetic offset — 5 s apart so timestamps are non-zero
      offset_seconds: i * 5,
    }));

    const meetingTitle = sourceMeetingTitle(title);
    db.createSession({
      id:            sessionId,
      title:         title || 'Pasted Transcript',
      meeting_title: meetingTitle,
      started_at:    now,
      status:     'generating',
      source:     'transcript',
    });

    // Run note generation + optional Notion upload asynchronously so the IPC call returns immediately
    // and the renderer can listen on processing:progress / processing:complete as usual.
    (async () => {
      const sendProgress: SendProgress = (stage, percent) => {
        if (stage !== 'complete') currentProcessing = { sessionId, stage, percent };
        sendToRenderer('processing:progress', { stage, percent });
        broadcastToExtension({ type: 'PROCESSING_PROGRESS', stage, percent });
      };

      try {
        // Save transcript immediately so the session is browsable right away
        db.updateSession(sessionId, { transcript: JSON.stringify(transcript) });

        sendProgress('generating', NOTES_PROGRESS_START);

        const notes = await generateAndStampNotes(sessionId, transcript, config, { provider: 'none', model: '' }, meetingTitle, sendProgress); // no STT for pasted transcripts

        db.updateSession(sessionId, {
          notes:  JSON.stringify(notes),
          title:  notes.meeting_title || notes.title || title || 'Pasted Transcript',
          ended_at: new Date().toISOString(),
          status: 'complete',
        });
        sendProgress('complete', 85);

        // Optional Notion upload
        let notionUrl: string | null = null;
        if (config.notionToken && config.notionPageId) {
          sendProgress('uploading', 85);
          db.updateSession(sessionId, { status: 'uploading' });
          notionUrl = await uploadSessionToNotion(sessionId, notes, transcript, config);
          db.updateSession(sessionId, { notion_page_url: notionUrl, status: 'complete' });
          sendProgress('complete', 100);
        }

        clearProcessingState(sessionId);

        sendToRenderer('processing:complete', { sessionId, notionUrl });
        broadcastToExtension({ type: 'PROCESSING_COMPLETE', notionUrl, sessionId });
        logger.info('Paste-transcript pipeline complete', { sessionId });
      } catch (err) {
        logger.error('Paste-transcript pipeline error', { sessionId, error: errorMessage(err) });
        db.updateSession(sessionId, { status: 'error', last_error: errorMessage(err) });
        clearProcessingState(sessionId);
        sendToRenderer('processing:error', { sessionId, error: errorMessage(err) });
        broadcastToExtension({ type: 'PROCESSING_ERROR', error: errorMessage(err) });
      }
    })();

    // Return immediately with the sessionId so the renderer can poll / listen
    return { success: true, sessionId };
  });

  // ── Auto updater ──────────────────────────────────────────────────────────
  ipc.handle('updater:check', () => checkForUpdates(true));
  ipc.handle('updater:download', () => downloadUpdate());
  ipc.handle('updater:install', () => quitAndInstall());
  ipc.handle('updater:get-status', () => getUpdaterState());
  ipc.handle('app:version', () => app.getVersion());

  // ── FFmpeg check ──────────────────────────────────────────────────────────
  ipc.handle('ffmpeg:check', () => {
    // Bundled binary first, then the in-app install (macOS), Homebrew, and finally PATH.
    function probeBinary(tool: string): FfmpegBinaryInfo {
      const hit = locate(tool);
      if (!hit) return { found: false, source: null, path: null, version: null };
      try {
        const result = spawnSync(hit.path, ['-version'], { encoding: 'utf8', timeout: 5000 });
        const versionLine = (result.stdout || result.stderr || '').split('\n')[0] || '';
        const match = versionLine.match(/version ([^\s]+)/i);
        return { found: true, source: hit.source, path: hit.path, version: match ? match[1] : 'unknown' };
      } catch {
        return { found: true, source: hit.source, path: hit.path, version: 'unknown' };
      }
    }

    return {
      ffmpeg: probeBinary('ffmpeg'),
      ffprobe: probeBinary('ffprobe'),
    };
  });

  // ── FFmpeg install ─────────────────────────────────────────────────────────
  ipc.handle('ffmpeg:install', async () => {
    const { installFfmpeg }: typeof import('./services/ffmpeg-installer') = require('./services/ffmpeg-installer');
    return installFfmpeg((stage, percent, message) => {
      sendToRenderer('ffmpeg:install-progress', { stage, percent, message });
    });
  });

  // ── Calendars (Google accounts + ICS links) ──────────────────────────────
  // Each handler resolves { success, ... } or { success: false, error } instead of throwing, so
  // the renderer shows the message as written.
  const calendarCall = <A extends unknown[], T extends object>(fn: (...args: A) => T | Promise<T>) =>
    async (_e: IpcMainInvokeEvent, ...args: A): Promise<CalendarOutcome<T>> => {
      try {
        return { success: true, ...(await fn(...args)) };
      } catch (err) {
        if (!isActionCancelled(err)) logger.warn('Calendar action failed', { error: errorMessage(err) });
        return { success: false, error: errorMessage(err), cancelled: isActionCancelled(err) };
      }
    };
  ipc.handle('calendar:list', () => calendar.list());
  ipc.handle('calendar:add', calendarCall(async (input: CalendarAddInput) => calendar.addSource(input)));
  ipc.handle('calendar:update', calendarCall((id: string, patch: CalendarUpdatePatch) => calendar.updateSource(id, patch)));
  ipc.handle('calendar:remove', calendarCall((id: string) => calendar.removeSource(id)));
  ipc.handle('calendar:reconnect', calendarCall((id: string) => calendar.reconnect(id)));
  ipc.handle('calendar:cancel-auth', () => calendar.cancelAuth());
  ipc.handle('calendar:events', calendarCall(({ force }: { force?: boolean } = {}) => calendar.fetchEvents({ force: !!force })));
}

// Node's web ReadableStream and the DOM's (the type `Response` takes) are one and the same at runtime.
function toResponseBody(stream: Readable): ReadableStream {
  return Readable.toWeb(stream) as unknown as ReadableStream;
}

function resolveSessionAudioPath(sessionId: string | null | undefined) {
  if (!sessionId) return null;
  const session = db.getSession(sessionId);
  if (!session) return null;

  const audioPath = session.audio_path;
  if (audioPath && fs.existsSync(audioPath)) return audioPath;

  const recordingsDir = getRecordingsDir();
  const wavPath = path.join(recordingsDir, `${sessionId}.wav`);
  const webmPath = path.join(recordingsDir, `${sessionId}.webm`);
  if (fs.existsSync(wavPath)) return wavPath;
  if (fs.existsSync(webmPath)) return webmPath;
  return null;
}

function probeDurationSeconds(audioPath: string | null | undefined) {
  if (!audioPath) return null;
  try {
    const seconds = getMediaDurationSeconds(audioPath);
    if (seconds == null) return null;
    const rounded = Math.round(seconds);
    return Number.isFinite(rounded) && rounded > 0 ? rounded : null;
  } catch (err) {
    logger.warn('Failed to probe media duration', { audioPath, error: errorMessage(err) });
    return null;
  }
}

/**
 * Use ffprobe to compute duration for every session that has an audio file.
 * Updates duration_seconds in the DB when a value is found.
 */
function backfillSessionDurations() {
  const sessions = db.listSessions();
  let updated = 0;

  for (const session of sessions) {
    const audioPath = resolveSessionAudioPath(session.id);
    if (!audioPath) continue;

    const durationSeconds = probeDurationSeconds(audioPath);
    if (durationSeconds == null) continue;
    if (session.duration_seconds === durationSeconds) continue;

    db.updateSession(session.id, { duration_seconds: durationSeconds });
    updated += 1;
  }

  if (updated > 0) {
    logger.info('Backfilled session durations via ffprobe', {
      updated,
      total: sessions.length,
    });
  } else {
    logger.info('Session duration backfill complete (no changes)', {
      total: sessions.length,
    });
  }

  return updated;
}

// ── Crash recovery ───────────────────────────────────────────────────────────

/**
 * Scan the recordings directory for orphaned .webm files left by crashed
 * renderer-capture sessions. For each one, try to convert it to .wav and
 * update the matching database session so the user can still access the audio.
 */
async function recoverOrphanedWebmFiles() {
  const recordingsDir = getRecordingsDir();
  if (!fs.existsSync(recordingsDir)) return;

  const webmFiles = fs.readdirSync(recordingsDir).filter((f) => f.endsWith('.webm'));
  if (webmFiles.length === 0) return;

  logger.info('Found orphaned webm files from crashed recordings', { count: webmFiles.length });

  for (const file of webmFiles) {
    const sessionId = path.basename(file, '.webm');
    const webmPath = path.join(recordingsDir, file);
    const wavPath = path.join(recordingsDir, `${sessionId}.wav`);

    try {
      const stat = fs.statSync(webmPath);
      if (stat.size === 0) {
        logger.warn('Orphaned webm is empty, removing', { sessionId });
        fs.unlinkSync(webmPath);
        continue;
      }

      // Only recover if a .wav doesn't already exist for this session
      if (fs.existsSync(wavPath)) {
        logger.info('WAV already exists for orphaned webm, cleaning up', { sessionId });
        try { fs.unlinkSync(webmPath); } catch { /* ignore */ }
        continue;
      }

      logger.info('Recovering crashed recording', { sessionId, webmBytes: stat.size });
      await convertWebmToWav(webmPath, wavPath);

      // Update the database session if it exists
      const session = db.getSession(sessionId);
      if (session && !session.audio_path) {
        const durationSeconds = probeDurationSeconds(wavPath);

        db.updateSession(sessionId, {
          audio_path: wavPath,
          ended_at: session.ended_at || new Date(stat.mtimeMs).toISOString(),
          duration_seconds: durationSeconds,
          status: 'recorded',
        });
        logger.info('Crashed recording recovered successfully', {
          sessionId,
          durationSeconds,
        });
      }

      // Clean up the webm now that we have the wav
      try { fs.unlinkSync(webmPath); } catch { /* ignore */ }
    } catch (err) {
      logger.error('Failed to recover orphaned webm', { sessionId, error: errorMessage(err) });
      // Leave the webm in place for manual recovery
    }
  }
}

// ── App lifecycle ─────────────────────────────────────────────────────────────

// Unpackaged runs (`pnpm run dev`, test drivers) get their own ID. When the bare electron.exe shows
// a notification, Electron creates a Start Menu shortcut ("Electron.lnk") for its ID; under the
// installed app's ID that shortcut renames MeetMind to "Electron" in Start search and the taskbar.
if (process.platform === 'win32') {
  app.setAppUserModelId(app.isPackaged ? 'com.meetmind.app' : 'com.meetmind.app.dev');
}

app.whenReady().then(async () => {
  logger.info('MeetMind starting up');

  // Show UI as early as possible — defer heavy recovery work.
  await db.initialize();
  db.markStaleRecordingSessionsAsError();
  registerIpcHandlers();

  // Serve session audio for renderer playback:
  // meetmind-audio://session/<sessionId>  (preferred)
  // meetmind-audio://<sessionId>          (legacy)
  protocol.handle('meetmind-audio', (request) => {
    try {
      const parsed = new URL(request.url);
      const pathId = decodeURIComponent(parsed.pathname.replace(/^\/+/, '').split('/')[0] || '');
      const sessionId = pathId || parsed.hostname || '';
      if (!sessionId || sessionId === 'session') {
        logger.warn('meetmind-audio request missing session id', { url: request.url });
        return new Response(null, { status: 400 });
      }

      const audioPath = resolveSessionAudioPath(sessionId);
      if (!audioPath) {
        logger.warn('meetmind-audio file not found', { sessionId });
        return new Response(null, { status: 404 });
      }

      const ext = path.extname(audioPath).toLowerCase();
      const mimeTypes: Record<string, string> = {
        '.wav': 'audio/wav',
        '.webm': 'audio/webm',
        '.mp3': 'audio/mpeg',
        '.m4a': 'audio/mp4',
        '.aac': 'audio/aac',
        '.ogg': 'audio/ogg',
        '.flac': 'audio/flac',
      };
      const mime = mimeTypes[ext] || 'application/octet-stream';
      const { size } = fs.statSync(audioPath);
      const rangeHeader = request.headers.get('Range');

      logger.info('meetmind-audio streaming file', { sessionId, audioPath, mime, range: rangeHeader || 'none' });

      if (rangeHeader) {
        const match = /bytes=(\d*)-(\d*)/.exec(rangeHeader);
        if (!match) {
          return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
        }
        const start = match[1] ? parseInt(match[1], 10) : 0;
        const end = match[2] ? parseInt(match[2], 10) : size - 1;
        if (Number.isNaN(start) || Number.isNaN(end) || start > end || start >= size) {
          return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
        }
        const chunkEnd = Math.min(end, size - 1);
        const chunkSize = chunkEnd - start + 1;
        const nodeStream = fs.createReadStream(audioPath, { start, end: chunkEnd });
        return new Response(toResponseBody(nodeStream), {
          status: 206,
          headers: {
            'Content-Type': mime,
            'Content-Length': String(chunkSize),
            'Content-Range': `bytes ${start}-${chunkEnd}/${size}`,
            'Accept-Ranges': 'bytes',
            'Cache-Control': 'no-cache',
          },
        });
      }

      const nodeStream = fs.createReadStream(audioPath);
      return new Response(toResponseBody(nodeStream), {
        status: 200,
        headers: {
          'Content-Type': mime,
          'Content-Length': String(size),
          'Accept-Ranges': 'bytes',
          'Cache-Control': 'no-cache',
        },
      });
    } catch (err) {
      logger.error('meetmind-audio protocol error', err);
      return new Response(null, { status: 500 });
    }
  });

  createAppMenu();
  // Packaged mac apps get their Dock icon from the bundle's .icns; in dev it's Electron's.
  if (isMac && !app.isPackaged) app.dock?.setIcon(path.join(appRoot, 'assets/icons/icon.png'));
  // A restart into an automatically installed update comes back where it was: in the tray.
  const relaunchedAfterUpdate = takeHiddenRelaunch();
  if (launchedHidden) logger.info('Started at login; staying in the tray');
  else if (relaunchedAfterUpdate) logger.info('Restarted after an automatic update; staying in the tray');
  installDisplayMediaHandler();
  // In the tray there is no window at all: one is made the first time the user opens the app.
  if (!launchedHidden && !relaunchedAfterUpdate) openMainWindow();
  createTray();

  initializeAutoUpdater({
    sendToRenderer,
    // Download progress changes many times a second; the tray menu only cares about the status.
    onStatusChange: ({ status }) => {
      if (status === lastTrayUpdaterStatus) return;
      lastTrayUpdaterStatus = status;
      updateTrayMenu();
    },
    isIdle: () => isIdleForUpdate({
      isRecording,
      activePipelines,
      activeMeeting: meetingDetector.activeMeeting(),
      overlayMode: overlayState.mode,
      windowVisible: isMainWindowVisible(),
    }),
  });

  // Keep meetmind:// pointed at this installed exe (not a leftover dev registration).
  if (app.isPackaged) {
    app.setAsDefaultProtocolClient('meetmind');
  }

  // Windows cold-start via meetmind:// puts the URL on process.argv
  const startupProtocolUrl = process.argv.find(
    (arg) => typeof arg === 'string' && arg.startsWith('meetmind://'),
  );
  if (startupProtocolUrl) {
    logger.info('Started via protocol', { startupProtocolUrl });
    focusMainWindow();
  }

  const config = getConfig();
  await startWebSocketServer(config.websocketPort, {
    onStartRecording: (data) => handleStartRecording(null, data.meetingUrl, data.meetingTitle),
    onStopRecording: () => handleStopRecording(),
    onShowWindow: () => focusMainWindow(),
    onStatusRequest: () => ({
      recording: isRecording,
      sessionId: currentSessionId,
    }),
    sendToRenderer,
  });

  // Background: convert leftover recordings and backfill durations without blocking first paint.
  recoverOrphanedWebmFiles()
    .catch((err) => {
      logger.error('Orphan recovery failed', err);
    })
    .finally(() => {
      try {
        backfillSessionDurations();
      } catch (err) {
        logger.error('Duration backfill failed', err);
      }
      // After crash recovery, so a recovered recording is judged by its meeting's date.
      try {
        runRetentionCleanup('startup');
      } catch (err) {
        logger.error('Recording cleanup failed', err);
      }
    });

  // Windows may have had launch at login disabled from Task Manager; store what it really is.
  const autoLaunchEnabled = autoLaunch.sync(config.autoLaunch);
  if (autoLaunchEnabled !== config.autoLaunch) setConfig('autoLaunch', autoLaunchEnabled);

  // "Meeting starting" prompts from the calendars with reminders on.
  calendar.init({ onChanged: () => sendToRenderer('calendar:changed') });
  startCalendarPoller();

  if (config.meetingDetection !== false) applyMeetingDetection(true);
  // After sleep, poll at once so a call joined right after waking is caught without waiting.
  // A window left on screen through sleep is checked too: it can wake up unpainted.
  powerMonitor.on('resume', () => {
    meetingDetector.handleResume();
    recheckOverlay();
    recheckMainWindow();
  });
  nativeTheme.on('updated', () => setOverlayTheme(resolveEffectiveTheme(getConfig().theme || 'light')));

  app.on('activate', () => {
    focusMainWindow();
  });
});

// Log helper processes that die (a GPU process crash can leave windows unpainted), so a missing
// window or overlay can be traced in the log. Renderer crashes are logged per window.
app.on('child-process-gone', (_event, details) => {
  if (details.reason === 'clean-exit') return;
  logger.warn('Child process gone', { type: details.type, reason: details.reason, exitCode: details.exitCode, name: details.name });
  // Chromium restarts the GPU process itself; make sure the window on screen came back with it.
  if (details.type === 'GPU') setTimeout(recheckMainWindow, 1500);
});

app.on('window-all-closed', () => {
  // Don't quit: MeetMind keeps running in the tray (Windows) or menu bar (macOS). Closing the
  // window only hides it (see the 'close' handler); Quit is in the tray menu, or ⌘Q on macOS.
});

app.on('before-quit', () => {
  app.isQuitting = true;
  stopWebSocketServer();
  calendar.stopPoller();
  meetingDetector.stop();
  destroyOverlay();
  destroyCapture();
  logger.info('MeetMind shutting down');
});

// ── Calendar Event Poller ─────────────────────────────────────────────────────

function startCalendarPoller() {
  calendar.startPoller((event) => {
    logger.info('Calendar meeting starting', { title: event.title, start: event.start, calendar: event.sourceName });

    // System notification. macOS (Electron 42+) shows notifications only for signed apps; an
    // unsigned build gets 'failed', and the in-app prompt below is all the user sees.
    if (Notification.isSupported()) {
      const notif = new Notification({
        title: 'Meeting Starting',
        body: `"${event.title}" is starting now.${event.meetingLink ? ' Click to start recording.' : ''}`,
        icon: nativeImage.createFromPath(path.join(appRoot, 'assets/icons/icon.png')),
      });
      notif.on('click', () => {
        focusMainWindow();
      });
      notif.on('failed', (_e, error) => {
        logger.warn('System notification failed; showing the in-app prompt only', { error });
      });
      notif.show();
    }

    // Notify the renderer so it can show an in-app prompt
    sendToRendererQueued('calendar:meeting-starting', event);
  });
}
