const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, shell, protocol, desktopCapturer, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { Readable } = require('stream');

const { getConfig, setConfig, setMultipleConfig, isFirstRun } = require('./utils/config');
const logger = require('./utils/logger');
const { startWebSocketServer, stopWebSocketServer, broadcastToExtension } = require('./websocket-server');
const { startRecording, stopRecording, listAudioDevices, probeAudioDevice, convertWebmToWav, convertFileToWav, getMediaDurationSeconds } = require('./audio/recorder');
const { transcribeAudio, testGoogleSTT, testAssemblyAI, testSarvam } = require('./services/transcription');
const { generateMeetingNotes, getAvailableModels, DEFAULT_SYSTEM_PROMPT, DEFAULT_MD_SYSTEM_PROMPT } = require('./services/gemini');
const { uploadToNotion, testNotionConnection } = require('./services/notion');
const { testGeminiConnection } = require('./services/gemini');
const { initializeAutoUpdater, checkForUpdates, quitAndInstall, getUpdaterState } = require('./services/updater');
const db = require('./db/sessions');

const isDev = process.env.NODE_ENV === 'development';

// Top-level crash guards for main process
process.on('uncaughtException', (err) => {
  logger.error('Uncaught Exception in main process', {
    error: err?.message || String(err),
    stack: err?.stack,
  });
});

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled Rejection in main process', {
    reason: reason instanceof Error ? reason.message : String(reason),
    stack: reason instanceof Error ? reason.stack : undefined,
  });
});

// Resolve the effective system prompt based on the configured output mode.
// If the user has a custom prompt saved, it always takes precedence.
// Otherwise fall back to the mode-appropriate default.
function resolveSystemPrompt(config) {
  if (config.geminiSystemPrompt && config.geminiSystemPrompt.trim()) {
    return config.geminiSystemPrompt.trim();
  }
  if (config.noteOutputMode === 'markdown') {
    return DEFAULT_MD_SYSTEM_PROMPT;
  }
  return DEFAULT_SYSTEM_PROMPT;
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

// Only the packaged app should own meetmind://.
// Registering from `npm run dev` steals the handler and points it at electron.exe,
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

let mainWindow = null;
let tray = null;
let isRecording = false;

function sendToRenderer(channel, ...args) {
  try {
    if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents && !mainWindow.webContents.isDestroyed()) {
      mainWindow.webContents.send(channel, ...args);
      return true;
    }
  } catch (err) {
    logger.warn(`Failed to send ${channel} to renderer`, { error: err.message });
  }
  return false;
}

function focusMainWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  } else {
    createMainWindow();
  }
}

// ── Window ──────────────────────────────────────────────────────────────────

function createMainWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
    return mainWindow;
  }

  mainWindow = new BrowserWindow({
    width: 1100,
    height: 720,
    minWidth: 800,
    minHeight: 600,
    backgroundColor: '#0c0c0f',
    frame: false,            // Custom titlebar in renderer — no native frame at all
    backgroundMaterial: 'none',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false,
    },
    show: false,
    icon: getAppIconPath(),
  });

  const rendererUrl = isDev
    ? 'http://localhost:5173'
    : `file://${path.join(__dirname, '../dist/renderer/index.html')}`;

  mainWindow.loadURL(rendererUrl);
  mainWindow.setTitle('MeetMind');
  mainWindow.on('page-title-updated', (e) => e.preventDefault());

  // Show quickly — don't wait forever for full renderer paint.
  mainWindow.once('ready-to-show', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show();
    }
  });
  setTimeout(() => {
    if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) {
      mainWindow.show();
    }
  }, 400);

  mainWindow.on('close', (event) => {
    if (!app.isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Auto-approve system audio loopback capture (no picker dialog).
  // Electron's loopback mode captures all system audio via Chromium's WASAPI
  // layer — works with speakers, headphones, USB, and Bluetooth output.
  mainWindow.webContents.session.setDisplayMediaRequestHandler((_request, callback) => {
    desktopCapturer.getSources({ types: ['screen'] }).then((sources) => {
      if (sources.length === 0) { callback(); return; }
      callback({ video: sources[0], audio: 'loopback' });
    }).catch(() => {
      callback();
    });
  }, { useSystemPicker: false });

  // Intercept all _blank window.open() calls and route to OS system browser.
  // Without this, Electron would open a new BrowserWindow for every outbound link.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      shell.openExternal(url).catch(() => {});
    }
    return { action: 'deny' };
  });

  if (isDev) {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }

  return mainWindow;
}

function resolveIconPath(...candidates) {
  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) return candidate;
  }
  return undefined;
}

function getAppIconPath() {
  // Prefer .ico on Windows for taskbar / window chrome; fall back to PNG.
  return resolveIconPath(
    path.join(__dirname, '../assets/icons/icon.ico'),
    path.join(__dirname, '../assets/icons/icon256.png'),
    path.join(__dirname, '../assets/icons/icon128.png'),
  );
}

function getTrayIcon() {
  // Windows tray looks crisp at 16/32; avoid empty/placeholder images.
  const trayPath = resolveIconPath(
    path.join(__dirname, '../assets/icons/icon32.png'),
    path.join(__dirname, '../assets/icons/icon16.png'),
    path.join(__dirname, '../assets/icons/icon.ico'),
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

function updateTrayMenu() {
  if (!tray) return;
  const updaterState = getUpdaterState();
  const updateDownloaded = updaterState.status === 'downloaded';

  const menuItems = [
    {
      label: 'Open MeetMind',
      click: () => { focusMainWindow(); },
    },
    { type: 'separator' },
  ];

  if (updateDownloaded) {
    menuItems.push({
      label: `✨ Restart to Update (v${updaterState.updateInfo?.version || ''})`,
      click: () => { quitAndInstall(); },
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

let currentSessionId = null;
let captureMode = 'none'; // 'none' | 'renderer' | 'ffmpeg'
let rendererWriteStream = null; // WriteStream for incremental renderer capture
let rendererWebmPath = null;    // Path to the in-progress .webm file
let rendererChunkCount = 0;     // Number of chunks flushed to disk
let rendererBytesWritten = 0;   // Total bytes flushed to disk

// ── Renderer capture IPC helpers ─────────────────────────────────────────────

function requestRendererCaptureStart() {
  return new Promise((resolve) => {
    if (!mainWindow || mainWindow.isDestroyed() || !mainWindow.webContents || mainWindow.webContents.isDestroyed()) {
      resolve(false);
      return;
    }

    function onStarted() { cleanup(); resolve(true); }
    function onFailed() { cleanup(); resolve(false); }
    function cleanup() {
      clearTimeout(timer);
      ipcMain.removeListener('capture:started', onStarted);
      ipcMain.removeListener('capture:failed', onFailed);
    }

    ipcMain.once('capture:started', onStarted);
    ipcMain.once('capture:failed', onFailed);
    sendToRenderer('capture:start');

    const timer = setTimeout(() => { cleanup(); resolve(false); }, 6000);
  });
}

/**
 * Tell the renderer to stop recording. The renderer will flush any remaining
 * chunks via capture:chunk, then send a zero-length capture:audio-data as a
 * "done" sentinel. We wait for that sentinel here.
 */
function requestRendererCaptureStop() {
  return new Promise((resolve, reject) => {
    if (!mainWindow || mainWindow.isDestroyed() || !mainWindow.webContents || mainWindow.webContents.isDestroyed()) {
      reject(new Error('No window'));
      return;
    }

    function onDone(_e, buffer) {
      clearTimeout(timer);
      // Sentinel received — all chunks have been flushed to disk already
      resolve();
    }

    ipcMain.once('capture:audio-data', onDone);
    sendToRenderer('capture:stop');

    const timer = setTimeout(() => {
      ipcMain.removeListener('capture:audio-data', onDone);
      // Even on timeout, the webm file on disk is still usable
      logger.warn('Renderer capture stop timed out, proceeding with partial file');
      resolve();
    }, 15000);
  });
}

// ── Start / Stop recording ───────────────────────────────────────────────────

async function handleStartRecording(sessionId, meetingUrl, meetingTitle) {
  if (isRecording) return { success: false, error: 'Already recording' };

  const { v4: uuidv4 } = require('uuid');
  currentSessionId = sessionId || uuidv4();

  db.createSession({
    id: currentSessionId,
    title: meetingTitle || 'Untitled Meeting',
    meeting_url: meetingUrl || '',
    started_at: new Date().toISOString(),
    status: 'recording',
  });

  try {
    // Primary: renderer captures system audio (Electron loopback) + mic via Web Audio
    const rendererOk = await requestRendererCaptureStart();

    if (rendererOk) {
      captureMode = 'renderer';
      isRecording = true;

      // Open write stream so incoming chunks are appended to disk immediately
      const recordingsDir = path.join(app.getPath('userData'), 'recordings');
      if (!fs.existsSync(recordingsDir)) fs.mkdirSync(recordingsDir, { recursive: true });
      rendererWebmPath = path.join(recordingsDir, `${currentSessionId}.webm`);
      rendererWriteStream = fs.createWriteStream(rendererWebmPath, { flags: 'w' });
      rendererChunkCount = 0;
      rendererBytesWritten = 0;

      updateTrayMenu();
      sendToRenderer('recording:started', { sessionId: currentSessionId });
      broadcastToExtension({ type: 'RECORDING_STARTED', sessionId: currentSessionId });
      logger.info('Recording started (renderer capture)', { sessionId: currentSessionId });
      return { success: true, sessionId: currentSessionId };
    }

    // Fallback: FFmpeg dshow recording (mic + Stereo Mix if available)
    logger.info('Renderer capture unavailable, falling back to FFmpeg');
    captureMode = 'ffmpeg';
    await startRecording(currentSessionId);
    isRecording = true;
    updateTrayMenu();
    sendToRenderer('recording:started', { sessionId: currentSessionId });
    broadcastToExtension({ type: 'RECORDING_STARTED', sessionId: currentSessionId });
    logger.info('Recording started (FFmpeg fallback)', { sessionId: currentSessionId });
    return { success: true, sessionId: currentSessionId };
  } catch (err) {
    logger.error('Failed to start recording', { error: err.message });
    captureMode = 'none';
    db.updateSession(currentSessionId, { status: 'error' });
    sendToRenderer('recording:error', { error: err.message });
    return { success: false, error: err.message };
  }
}

async function handleStopRecording() {
  if (!isRecording) return { success: false, error: 'Not recording' };

  try {
    let audioPath;
    const endedAt = new Date().toISOString();
    const recordingsDir = path.join(app.getPath('userData'), 'recordings');
    if (!fs.existsSync(recordingsDir)) fs.mkdirSync(recordingsDir, { recursive: true });

    if (captureMode === 'renderer') {
      // Signal the renderer to stop and flush remaining chunks
      await requestRendererCaptureStop();

      // Close the write stream that has been accumulating chunks
      if (rendererWriteStream) {
        await new Promise((res) => rendererWriteStream.end(res));
        rendererWriteStream = null;
      }

      const webmPath = rendererWebmPath || path.join(recordingsDir, `${currentSessionId}.webm`);
      const wavPath = path.join(recordingsDir, `${currentSessionId}.wav`);

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

    let durationSeconds = null;
    try {
      if (audioPath) {
        durationSeconds = probeDurationSeconds(audioPath);
      }
    } catch (err) {
      logger.warn('Failed to compute audio duration from file', {
        sessionId: currentSessionId,
        audioPath,
        error: err.message,
      });
    }

    db.updateSession(currentSessionId, {
      ended_at: endedAt,
      audio_path: audioPath,
      duration_seconds: durationSeconds,
      status: 'transcribing',
    });

    updateTrayMenu();
    sendToRenderer('recording:stopped', { sessionId: currentSessionId, audioPath });
    broadcastToExtension({ type: 'RECORDING_STOPPED' });
    logger.info('Recording stopped', { sessionId: currentSessionId, audioPath });

    runProcessingPipeline(currentSessionId, audioPath);

    return { success: true, sessionId: currentSessionId };
  } catch (err) {
    logger.error('Failed to stop recording', { error: err.message });
    if (rendererWriteStream) {
      try { rendererWriteStream.end(); } catch { /* ignore */ }
      rendererWriteStream = null;
    }
    rendererWebmPath = null;
    rendererChunkCount = 0;
    rendererBytesWritten = 0;
    captureMode = 'none';
    isRecording = false;
    if (currentSessionId) {
      db.updateSession(currentSessionId, {
        status: 'error',
        ended_at: new Date().toISOString(),
      });
    }
    return { success: false, error: err.message };
  }
}

async function runProcessingPipeline(sessionId, audioPath, options = {}) {
  const sendProgress = (stage, percent) => {
    sendToRenderer('processing:progress', { stage, percent });
    broadcastToExtension({ type: 'PROCESSING_PROGRESS', stage, percent });
  };

  try {
    const config = getConfig();
    const session = db.getSession(sessionId);
    let transcript = null;

    // Check if transcript already exists for this session unless forceRetranscribe is true
    if (!options?.forceRetranscribe && session && session.transcript) {
      try {
        const parsed = typeof session.transcript === 'string' ? JSON.parse(session.transcript) : session.transcript;
        if (Array.isArray(parsed) && parsed.length > 0) {
          transcript = parsed;
          logger.info('Reusing existing transcript for session', { sessionId, segments: transcript.length });
        }
      } catch (e) {
        logger.warn('Failed to parse existing transcript, will re-transcribe', { sessionId, error: e.message });
      }
    }

    if (!transcript) {
      // Stage 1: Transcription (0–60%)
      sendProgress('transcribing', 0);
      const onTranscriptionProgress = (pct) => sendProgress('transcribing', Math.round(pct * 0.6));
      transcript = await transcribeAudio(
        audioPath,
        config.googleApiKey,
        onTranscriptionProgress,
        config.googleCloudProjectId,
        config.googleCloudStorageBucket,
        config.googleCloudStorageKeyPath,
        config.sttService,
        config.assemblyAiApiKey,
        config.assemblyAiPrompt,
        config.sarvamApiKey
      );

      // transcribeAudio throws for silent files; if we get here but with empty results,
      // treat it the same way (STT may return empty for near-silence)
      if (!transcript || transcript.length === 0) {
        throw new Error(
          'No speech detected in the recording. ' +
          'Stereo Mix only captures audio playing through your speakers. ' +
          'To test capture: play a video or music while recording. ' +
          'To capture your voice: select your microphone in Settings → Audio.'
        );
      }

      db.updateSession(sessionId, { transcript: JSON.stringify(transcript), status: 'generating' });
    } else {
      db.updateSession(sessionId, { status: 'generating' });
    }

    sendProgress('generating', 60);

    // Stage 2: Gemini notes (60–85%)
    const notes = await generateMeetingNotes(transcript, config.selectedModel, config.geminiApiKey, resolveSystemPrompt(config));
    db.updateSession(sessionId, {
      notes: JSON.stringify(notes),
      title: notes.meeting_title || notes.title || 'Untitled Meeting',
      status: 'complete',
    });
    sendProgress('complete', 85);

    // Stage 3: Notion upload (85–100%) — optional, only if configured
    let notionUrl = null;
    if (config.notionToken && config.notionPageId) {
      sendProgress('uploading', 85);
      db.updateSession(sessionId, { status: 'uploading' });
      notionUrl = await uploadToNotion(notes, transcript, config.notionPageId, config.notionToken);
      db.updateSession(sessionId, { notion_page_url: notionUrl, status: 'complete' });
      sendProgress('complete', 100);
    }

    sendToRenderer('processing:complete', { sessionId, notionUrl });
    broadcastToExtension({ type: 'PROCESSING_COMPLETE', notionUrl, sessionId });
    logger.info('Processing pipeline complete', { sessionId, notionUrl });
  } catch (err) {
    logger.error('Processing pipeline error', { sessionId, error: err.message });
    db.updateSession(sessionId, { status: 'error' });
    sendToRenderer('processing:error', { sessionId, error: err.message });
    broadcastToExtension({ type: 'PROCESSING_ERROR', error: err.message });
  }
}

// ── IPC Handlers ─────────────────────────────────────────────────────────────

function registerIpcHandlers() {
  // ── Custom window controls (frameless window) ──────────────────────────────
  ipcMain.handle('window:minimize',  () => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.minimize();
  });
  ipcMain.handle('window:maximize',  () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMaximized()) mainWindow.restore();
      else mainWindow.maximize();
    }
  });
  ipcMain.handle('window:close',     () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.close();
    }
  });
  ipcMain.handle('window:isMaximized', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      return mainWindow.isMaximized();
    }
    return false;
  });

  // Open a URL in the OS default browser (safe: only http/https allowed)
  ipcMain.handle('shell:open-external', (_e, url) => {
    if (typeof url === 'string' && (url.startsWith('http://') || url.startsWith('https://'))) {
      return shell.openExternal(url);
    }
  });

  // ── Logs ──────────────────────────────────────────────────────────────────
  ipcMain.handle('logs:get', (_e, { limit } = {}) => logger.readLogs(limit));
  ipcMain.handle('logs:clear', () => logger.clearLogs());
  ipcMain.handle('logs:openFolder', () => shell.openPath(logger.getLogsDir()));

  ipcMain.handle('config:get', () => getConfig());

  ipcMain.handle('config:set', (_e, key, value) => {
    setConfig(key, value);
    if (key === 'autoLaunch') {
      app.setLoginItemSettings({ openAtLogin: value });
    }
    return true;
  });

  ipcMain.handle('config:set-multiple', (_e, updates) => {
    setMultipleConfig(updates);
    if ('autoLaunch' in updates) {
      app.setLoginItemSettings({ openAtLogin: updates.autoLaunch });
    }
    return true;
  });

  ipcMain.handle('recording:start', (_e, sessionId, meetingUrl, meetingTitle) =>
    handleStartRecording(sessionId, meetingUrl, meetingTitle)
  );

  ipcMain.handle('recording:stop', () => handleStopRecording());

  // Incremental audio chunk from renderer capture — append to disk
  ipcMain.on('capture:chunk', (_e, buffer) => {
    if (!rendererWriteStream) {
      logger.warn('Received capture:chunk but no write stream is open');
      return;
    }
    try {
      const chunk = Buffer.from(buffer);
      rendererWriteStream.write(chunk);
      rendererChunkCount++;
      rendererBytesWritten += chunk.length;
    } catch (err) {
      logger.error('Failed to write audio chunk to disk', { error: err.message });
    }
  });

  ipcMain.handle('audio:list-devices', () => listAudioDevices());

  ipcMain.handle('audio:probe-device', (_e, device) => probeAudioDevice(device));

  ipcMain.handle('audio:import-file', async () => {
    const parentWin = mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined;
    const { canceled, filePaths } = await dialog.showOpenDialog(parentWin, {
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
      const { v4: uuidv4 } = require('uuid');
      const sessionId = uuidv4();

      const recordingsDir = path.join(app.getPath('userData'), 'recordings');
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

      let durationSeconds = null;
      try {
        durationSeconds = probeDurationSeconds(destPath);
      } catch (err) {
        logger.warn('Failed to compute duration for imported audio', {
          srcPath,
          destPath,
          error: err.message,
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
      logger.error('Audio import failed', { error: err.message });
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('sessions:list', () => db.listSessions());

  ipcMain.handle('session:get', (_e, id) => db.getSession(id));

  ipcMain.handle('session:delete', (_e, id) => {
    db.deleteSession(id);
    return true;
  });

  ipcMain.handle('session:open-recording', async (_e, sessionId) => {
    const audioPath = resolveSessionAudioPath(sessionId);
    if (!audioPath) {
      return { success: false, error: 'Recording file not found for this session.' };
    }
    try {
      shell.showItemInFolder(audioPath);
      return { success: true, path: audioPath };
    } catch (err) {
      logger.error('Failed to open recording file', { sessionId, audioPath, error: err.message });
      return { success: false, error: err.message || 'Failed to open recording file.' };
    }
  });

  ipcMain.handle('notion:upload', async (_e, sessionId) => {
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
      const url = await uploadToNotion(notes, transcript, config.notionPageId, config.notionToken);
      db.updateSession(sessionId, { notion_page_url: url });
      return { success: true, url };
    } catch (err) {
      logger.error('Notion upload failed', { error: err.message });
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('notion:test', async (_e, token, pageId) => {
    try {
      const res = await testNotionConnection(pageId, token);
      return { success: true, ...(res || {}) };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('models:list', () => getAvailableModels());

  ipcMain.handle('gemini:default-system-prompt', () => DEFAULT_SYSTEM_PROMPT);

  ipcMain.handle('gemini:default-md-system-prompt', () => DEFAULT_MD_SYSTEM_PROMPT);

  ipcMain.handle('api:test-google', async (_e, apiKey, _projectId) => {
    try {
      await testGoogleSTT(apiKey);
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('api:test-assemblyai', async (_e, apiKey) => {
    try {
      await testAssemblyAI(apiKey);
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('api:test-sarvam', async (_e, apiKey) => {
    try {
      await testSarvam(apiKey);
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('api:test-gemini', async (_e, apiKey, modelId) => {
    try {
      await testGeminiConnection(apiKey, modelId);
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('processing:run', async (_e, sessionId) => {
    const session = db.getSession(sessionId);
    if (!session || !session.audio_path) {
      return { success: false, error: 'No audio file found for session' };
    }
    runProcessingPipeline(sessionId, session.audio_path);
    return { success: true };
  });

  ipcMain.handle('processing:retry', async (_e, sessionId, stage) => {
    const session = db.getSession(sessionId);
    if (!session) return { success: false, error: 'Session not found' };

    if (stage === 'notes') {
      runProcessingPipeline(sessionId, session.audio_path, { forceRetranscribe: false });
      return { success: true };
    }
    if (stage === 'all' || stage === 'transcription') {
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
        const url = await uploadToNotion(notes, transcript, config.notionPageId, config.notionToken);
        db.updateSession(sessionId, { notion_page_url: url, status: 'complete' });
        return { success: true, url };
      } catch (err) {
        return { success: false, error: err.message };
      }
    }
    return { success: false, error: 'Unknown stage' };
  });

  // ── Auto updater ──────────────────────────────────────────────────────────
  ipcMain.handle('updater:check', (_e) => checkForUpdates(true));
  ipcMain.handle('updater:install', (_e) => quitAndInstall());
  ipcMain.handle('updater:get-status', (_e) => getUpdaterState());
  ipcMain.handle('app:version', (_e) => app.getVersion());
}

function resolveSessionAudioPath(sessionId) {
  if (!sessionId) return null;
  const session = db.getSession(sessionId);
  if (!session) return null;

  let audioPath = session.audio_path;
  if (audioPath && fs.existsSync(audioPath)) return audioPath;

  const recordingsDir = path.join(app.getPath('userData'), 'recordings');
  const wavPath = path.join(recordingsDir, `${sessionId}.wav`);
  const webmPath = path.join(recordingsDir, `${sessionId}.webm`);
  if (fs.existsSync(wavPath)) return wavPath;
  if (fs.existsSync(webmPath)) return webmPath;
  return null;
}

function probeDurationSeconds(audioPath) {
  if (!audioPath) return null;
  try {
    const seconds = getMediaDurationSeconds(audioPath);
    if (seconds == null) return null;
    const rounded = Math.round(seconds);
    return Number.isFinite(rounded) && rounded > 0 ? rounded : null;
  } catch (err) {
    logger.warn('Failed to probe media duration', { audioPath, error: err.message });
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
    sendToRenderer('sessions:durations-updated');
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
  const recordingsDir = path.join(app.getPath('userData'), 'recordings');
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
      logger.error('Failed to recover orphaned webm', { sessionId, error: err.message });
      // Leave the webm in place for manual recovery
    }
  }
}

// ── App lifecycle ─────────────────────────────────────────────────────────────

if (process.platform === 'win32') {
  app.setAppUserModelId('com.meetmind.app');
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
      const mimeTypes = {
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
        return new Response(Readable.toWeb(nodeStream), {
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
      return new Response(Readable.toWeb(nodeStream), {
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

  createMainWindow();
  createTray();

  initializeAutoUpdater({
    sendToRenderer,
    onUpdateDownloaded: () => {
      updateTrayMenu();
    },
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
    });

  app.on('open-url', (event, url) => {
    event.preventDefault();
    if (url.startsWith('meetmind://')) focusMainWindow();
  });

  app.setLoginItemSettings({ openAtLogin: config.autoLaunch });

  app.on('activate', () => {
    focusMainWindow();
  });
});

app.on('window-all-closed', () => {
  // Keep running in tray on Windows
  if (process.platform !== 'darwin') {
    // Don't quit — stay in tray
  }
});

app.on('before-quit', () => {
  app.isQuitting = true;
  stopWebSocketServer();
  logger.info('MeetMind shutting down');
});
