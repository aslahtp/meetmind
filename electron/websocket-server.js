const http = require('http');
const { WebSocketServer } = require('ws');
const logger = require('./utils/logger');

let wss = null;
let httpServer = null;
let extensionSocket = null;
const PORT_RANGE = 11; // try port, port+1, ... port+10

/**
 * Try to listen on a single port. Resolves with { wss, httpServer, port } when ready.
 */
function tryListen(port, handlers) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = req.url || '/';
      // Allow the extension to raise the window even when the WebSocket is down.
      if (req.method === 'GET' && (url === '/open' || url.startsWith('/open?'))) {
        try {
          handlers.onShowWindow?.();
        } catch (err) {
          logger.error('Failed to show window via /open', { error: err.message });
        }
        res.writeHead(200, {
          'Content-Type': 'text/plain',
          'Access-Control-Allow-Origin': '*',
        });
        res.end('ok');
        return;
      }

      if (req.method === 'GET' && (url === '/health' || url.startsWith('/health?'))) {
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        });
        res.end(JSON.stringify({ ok: true, app: 'MeetMind' }));
        return;
      }

      res.writeHead(404, { 'Access-Control-Allow-Origin': '*' });
      res.end('Not found');
    });

    const socketServer = new WebSocketServer({ server });

    server.once('listening', () => {
      logger.info(`WebSocket server listening on ws://localhost:${port}`);
      resolve({ wss: socketServer, httpServer: server, port });
    });

    server.once('error', (err) => {
      try { socketServer.close(); } catch (_) { /* ignore */ }
      try { server.close(); } catch (_) { /* ignore */ }
      reject(err);
    });

    server.listen(port, '127.0.0.1');
  });
}

/**
 * Attach connection handler and message logic to the server.
 */
function attachHandlers(server, port, handlers) {
  server.on('connection', (ws, req) => {
    const origin = req.headers.origin || '';

    if (!origin.startsWith('chrome-extension://')) {
      logger.warn('Rejected WebSocket connection from unknown origin', { origin });
      ws.close(4001, 'Forbidden');
      return;
    }

    logger.info('Chrome extension connected', { origin });
    extensionSocket = ws;

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

    const status = handlers.onStatusRequest();
    ws.send(JSON.stringify({
      type: 'APP_STATUS',
      recording: status.recording,
      sessionId: status.sessionId,
    }));
  });
}

/**
 * Start the WebSocket server. Tries port, then port+1, ... port+10 until one is free.
 */
async function startWebSocketServer(port, handlers) {
  let lastErr = null;

  for (let i = 0; i < PORT_RANGE; i++) {
    const tryPort = port + i;
    try {
      const started = await tryListen(tryPort, handlers);
      wss = started.wss;
      httpServer = started.httpServer;
      attachHandlers(wss, tryPort, handlers);
      return wss;
    } catch (err) {
      lastErr = err;
      if (err.code === 'EADDRINUSE') {
        logger.warn(`Port ${tryPort} in use, trying next...`);
        continue;
      }
      logger.error('WebSocket server error', { error: err.message });
      throw err;
    }
  }

  logger.error('WebSocket server failed: all ports in use', {
    ports: `${port}–${port + PORT_RANGE - 1}`,
    hint: 'Close other MeetMind instances or free one of these ports.',
  });
  throw lastErr || new Error('Could not bind WebSocket server');
}

function handleExtensionMessage(message, ws, handlers) {
  logger.debug('Received extension message', { type: message.type });

  switch (message.type) {
    case 'START_RECORDING':
      handlers.onStartRecording({
        meetingUrl:   message.meetingUrl   || '',
        meetingTitle: message.meetingTitle || 'Untitled Meeting',
      });
      handlers.mainWindow?.webContents.send('ws:recording-requested', {
        meetingUrl:   message.meetingUrl,
        meetingTitle: message.meetingTitle,
      });
      break;

    case 'STOP_RECORDING':
      handlers.onStopRecording();
      break;

    case 'APP_STATUS': {
      const status = handlers.onStatusRequest();
      ws.send(JSON.stringify({
        type: 'APP_STATUS',
        recording: status.recording,
        sessionId: status.sessionId,
      }));
      break;
    }

    case 'SHOW_WINDOW':
      handlers.onShowWindow?.();
      break;

    default:
      logger.warn('Unknown WebSocket message type', { type: message.type });
  }
}

function broadcastToExtension(message) {
  if (!extensionSocket || extensionSocket.readyState !== 1) return;
  try {
    extensionSocket.send(JSON.stringify(message));
  } catch (err) {
    logger.error('Failed to send message to extension', { error: err.message });
  }
}

function stopWebSocketServer() {
  if (wss) {
    try { wss.close(); } catch (_) { /* ignore */ }
    wss = null;
  }
  if (httpServer) {
    try { httpServer.close(); } catch (_) { /* ignore */ }
    httpServer = null;
  }
  logger.info('WebSocket server stopped');
}

module.exports = { startWebSocketServer, stopWebSocketServer, broadcastToExtension };
