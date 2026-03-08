const { WebSocketServer } = require('ws');
const logger = require('./utils/logger');

let wss = null;
let extensionSocket = null;

/**
 * Start the WebSocket server that bridges the Chrome extension to Electron.
 */
function startWebSocketServer(port, handlers) {
  wss = new WebSocketServer({ port });

  wss.on('listening', () => {
    logger.info(`WebSocket server listening on ws://localhost:${port}`);
  });

  wss.on('error', (err) => {
    logger.error('WebSocket server error', { error: err.message });
  });

  wss.on('connection', (ws, req) => {
    const origin = req.headers.origin || '';

    // Only allow connections from the Chrome extension
    if (!origin.startsWith('chrome-extension://')) {
      logger.warn('Rejected WebSocket connection from unknown origin', { origin });
      ws.close(4001, 'Forbidden');
      return;
    }

    logger.info('Chrome extension connected', { origin });
    extensionSocket = ws;

    // Notify renderer that extension connected
    handlers.mainWindow?.webContents.send('ws:extension-connected', { origin });

    ws.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString());
        handleExtensionMessage(message, ws, handlers);
      } catch (err) {
        logger.error('Failed to parse WebSocket message', { error: err.message });
      }
    });

    ws.on('close', () => {
      logger.info('Chrome extension disconnected');
      if (extensionSocket === ws) extensionSocket = null;
    });

    ws.on('error', (err) => {
      logger.error('WebSocket client error', { error: err.message });
    });

    // Send current app status on connect
    const status = handlers.onStatusRequest();
    ws.send(JSON.stringify({
      type: 'APP_STATUS',
      recording: status.recording,
      sessionId: status.sessionId,
    }));
  });

  return wss;
}

function handleExtensionMessage(message, ws, handlers) {
  logger.debug('Received extension message', { type: message.type });

  switch (message.type) {
    case 'START_RECORDING':
      handlers.onStartRecording({
        meetingUrl:   message.meetingUrl   || '',
        meetingTitle: message.meetingTitle || 'Untitled Meeting',
      });
      // Notify renderer so it can react
      handlers.mainWindow?.webContents.send('ws:recording-requested', {
        meetingUrl:   message.meetingUrl,
        meetingTitle: message.meetingTitle,
      });
      break;

    case 'STOP_RECORDING':
      handlers.onStopRecording();
      break;

    case 'APP_STATUS':
      // Heartbeat — respond with current status
      const status = handlers.onStatusRequest();
      ws.send(JSON.stringify({
        type: 'APP_STATUS',
        recording: status.recording,
        sessionId: status.sessionId,
      }));
      break;

    default:
      logger.warn('Unknown WebSocket message type', { type: message.type });
  }
}

/**
 * Send a message to the connected Chrome extension.
 */
function broadcastToExtension(message) {
  if (!extensionSocket || extensionSocket.readyState !== 1 /* OPEN */) return;
  try {
    extensionSocket.send(JSON.stringify(message));
  } catch (err) {
    logger.error('Failed to send message to extension', { error: err.message });
  }
}

function stopWebSocketServer() {
  if (wss) {
    wss.close();
    wss = null;
    logger.info('WebSocket server stopped');
  }
}

module.exports = { startWebSocketServer, stopWebSocketServer, broadcastToExtension };
