const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, shell } = require('electron');
const path = require('path');
const fs = require('fs');

const { getConfig, setConfig, setMultipleConfig, isFirstRun } = require('./utils/config');
const logger = require('./utils/logger');
const { startWebSocketServer, stopWebSocketServer, broadcastToExtension } = require('./websocket-server');
const { startRecording, stopRecording, listAudioDevices } = require('./audio/recorder');
const { transcribeAudio } = require('./services/transcription');
const { generateMeetingNotes, getAvailableModels } = require('./services/gemini');
const { uploadToNotion, testNotionConnection } = require('./services/notion');
const { testGoogleSTT } = require('./services/transcription');
const { testGeminiConnection } = require('./services/gemini');
const db = require('./db/sessions');

const isDev = process.env.NODE_ENV === 'development';

let mainWindow = null;
let tray = null;
let isRecording = false;

// ── Window ──────────────────────────────────────────────────────────────────

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 720,
    minWidth: 800,
    minHeight: 600,
    backgroundColor: '#1a1a1a',
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#1a1a1a',
      symbolColor: '#ffffff',
      height: 32,
    },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
    show: false,
    icon: getAppIconPath(),
  });

  const rendererUrl = isDev
    ? 'http://localhost:5173'
    : `file://${path.join(__dirname, '../dist/renderer/index.html')}`;

  mainWindow.loadURL(rendererUrl);

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.on('close', (event) => {
    if (!app.isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });

  if (isDev) {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }

  return mainWindow;
}

function getAppIconPath() {
  const iconPath = isDev
    ? path.join(__dirname, '../assets/icons/icon.ico')
    : path.join(__dirname, '../assets/icons/icon.ico');
  return fs.existsSync(iconPath) ? iconPath : undefined;
}

// ── Tray ─────────────────────────────────────────────────────────────────────

function createTray() {
  const trayIconPath = isDev
    ? path.join(__dirname, '../assets/icons/icon16.png')
    : path.join(__dirname, '../assets/icons/icon16.png');

  const icon = fs.existsSync(trayIconPath)
    ? nativeImage.createFromPath(trayIconPath)
    : nativeImage.createEmpty();

  tray = new Tray(icon);
  tray.setToolTip('MeetMind');
  updateTrayMenu();

  tray.on('double-click', () => {
    mainWindow?.show();
    mainWindow?.focus();
  });
}

function updateTrayMenu() {
  if (!tray) return;
  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Open MeetMind',
      click: () => { mainWindow?.show(); mainWindow?.focus(); },
    },
    { type: 'separator' },
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
      label: 'Quit',
      click: () => {
        app.isQuitting = true;
        app.quit();
      },
    },
  ]);
  tray.setContextMenu(contextMenu);
}

// ── Recording helpers ────────────────────────────────────────────────────────

let currentSessionId = null;

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
    await startRecording(currentSessionId);
    isRecording = true;
    updateTrayMenu();
    mainWindow?.webContents.send('recording:started', { sessionId: currentSessionId });
    broadcastToExtension({ type: 'RECORDING_STARTED', sessionId: currentSessionId });
    logger.info('Recording started', { sessionId: currentSessionId });
    return { success: true, sessionId: currentSessionId };
  } catch (err) {
    logger.error('Failed to start recording', { error: err.message });
    db.updateSession(currentSessionId, { status: 'error' });
    mainWindow?.webContents.send('recording:error', { error: err.message });
    return { success: false, error: err.message };
  }
}

async function handleStopRecording() {
  if (!isRecording) return { success: false, error: 'Not recording' };

  try {
    const audioPath = await stopRecording();
    isRecording = false;
    const endedAt = new Date().toISOString();

    db.updateSession(currentSessionId, {
      ended_at: endedAt,
      audio_path: audioPath,
      status: 'transcribing',
    });

    updateTrayMenu();
    mainWindow?.webContents.send('recording:stopped', { sessionId: currentSessionId, audioPath });
    broadcastToExtension({ type: 'RECORDING_STOPPED' });
    logger.info('Recording stopped', { sessionId: currentSessionId, audioPath });

    // Kick off async processing pipeline
    runProcessingPipeline(currentSessionId, audioPath);

    return { success: true, sessionId: currentSessionId };
  } catch (err) {
    logger.error('Failed to stop recording', { error: err.message });
    return { success: false, error: err.message };
  }
}

async function runProcessingPipeline(sessionId, audioPath) {
  const sendProgress = (stage, percent) => {
    mainWindow?.webContents.send('processing:progress', { stage, percent });
    broadcastToExtension({ type: 'PROCESSING_PROGRESS', stage, percent });
  };

  try {
    // Stage 1: Transcription (0–60%)
    sendProgress('transcribing', 0);
    const config = getConfig();

    const onTranscriptionProgress = (pct) => sendProgress('transcribing', Math.round(pct * 0.6));
    const transcript = await transcribeAudio(audioPath, config.googleApiKey, onTranscriptionProgress);

    db.updateSession(sessionId, { transcript: JSON.stringify(transcript), status: 'generating' });
    sendProgress('generating', 60);

    // Stage 2: Gemini notes (60–85%)
    const notes = await generateMeetingNotes(transcript, config.selectedModel, config.geminiApiKey);
    db.updateSession(sessionId, {
      notes: JSON.stringify(notes),
      title: notes.title || 'Untitled Meeting',
      status: 'complete',
    });
    sendProgress('complete', 85);

    // Stage 3: Notion upload (85–100%) — optional, only if configured
    let notionUrl = null;
    if (config.notionToken && config.notionDatabaseId) {
      sendProgress('uploading', 85);
      db.updateSession(sessionId, { status: 'uploading' });
      notionUrl = await uploadToNotion(notes, transcript, config.notionDatabaseId, config.notionToken);
      db.updateSession(sessionId, { notion_page_url: notionUrl, status: 'complete' });
      sendProgress('complete', 100);
    }

    mainWindow?.webContents.send('processing:complete', { sessionId, notionUrl });
    broadcastToExtension({ type: 'PROCESSING_COMPLETE', notionUrl, sessionId });
    logger.info('Processing pipeline complete', { sessionId, notionUrl });
  } catch (err) {
    logger.error('Processing pipeline error', { sessionId, error: err.message });
    db.updateSession(sessionId, { status: 'error' });
    mainWindow?.webContents.send('processing:error', { sessionId, error: err.message });
    broadcastToExtension({ type: 'PROCESSING_ERROR', error: err.message });
  }
}

// ── IPC Handlers ─────────────────────────────────────────────────────────────

function registerIpcHandlers() {
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

  ipcMain.handle('audio:list-devices', () => listAudioDevices());

  ipcMain.handle('sessions:list', () => db.listSessions());

  ipcMain.handle('session:get', (_e, id) => db.getSession(id));

  ipcMain.handle('session:delete', (_e, id) => {
    db.deleteSession(id);
    return true;
  });

  ipcMain.handle('notion:upload', async (_e, sessionId) => {
    const session = db.getSession(sessionId);
    if (!session) return { success: false, error: 'Session not found' };

    const config = getConfig();
    if (!config.notionToken || !config.notionDatabaseId) {
      return { success: false, error: 'Notion not configured' };
    }

    try {
      const notes = JSON.parse(session.notes || '{}');
      const transcript = JSON.parse(session.transcript || '[]');
      const url = await uploadToNotion(notes, transcript, config.notionDatabaseId, config.notionToken);
      db.updateSession(sessionId, { notion_page_url: url });
      return { success: true, url };
    } catch (err) {
      logger.error('Notion upload failed', { error: err.message });
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('notion:test', async (_e, token, dbId) => {
    try {
      await testNotionConnection(token, dbId);
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('models:list', () => getAvailableModels());

  ipcMain.handle('api:test-google', async (_e, apiKey) => {
    try {
      await testGoogleSTT(apiKey);
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('api:test-gemini', async (_e, apiKey) => {
    try {
      await testGeminiConnection(apiKey);
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

    const config = getConfig();
    try {
      if (stage === 'transcription' || stage === 'all') {
        const transcript = await transcribeAudio(session.audio_path, config.googleApiKey);
        db.updateSession(sessionId, { transcript: JSON.stringify(transcript) });
      }
      if (stage === 'notes' || stage === 'all') {
        const session2 = db.getSession(sessionId);
        const transcript = JSON.parse(session2.transcript || '[]');
        const notes = await generateMeetingNotes(transcript, config.selectedModel, config.geminiApiKey);
        db.updateSession(sessionId, { notes: JSON.stringify(notes), title: notes.title });
      }
      if (stage === 'notion') {
        const session3 = db.getSession(sessionId);
        const notes = JSON.parse(session3.notes || '{}');
        const transcript = JSON.parse(session3.transcript || '[]');
        const url = await uploadToNotion(notes, transcript, config.notionDatabaseId, config.notionToken);
        db.updateSession(sessionId, { notion_page_url: url, status: 'complete' });
        return { success: true, url };
      }
      db.updateSession(sessionId, { status: 'complete' });
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });
}

// ── App lifecycle ─────────────────────────────────────────────────────────────

app.whenReady().then(() => {
  logger.info('MeetMind starting up');

  db.initialize();
  registerIpcHandlers();
  createMainWindow();
  createTray();

  const config = getConfig();
  startWebSocketServer(config.websocketPort, {
    onStartRecording: (data) => handleStartRecording(null, data.meetingUrl, data.meetingTitle),
    onStopRecording: () => handleStopRecording(),
    onStatusRequest: () => ({
      recording: isRecording,
      sessionId: currentSessionId,
    }),
    mainWindow,
  });

  app.setLoginItemSettings({ openAtLogin: config.autoLaunch });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
    else mainWindow?.show();
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
