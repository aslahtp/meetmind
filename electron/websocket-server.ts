import http from 'http';
import { WebSocketServer, type RawData, type WebSocket } from 'ws';
import logger from './utils/logger';
import { errorCode, errorMessage } from './utils/errors';

/** What main supplies to react to the extension. */
interface ExtensionHandlers {
  onStartRecording?: (request: { meetingUrl: string; meetingTitle: string }) => void;
  onStopRecording?: () => void;
  onShowWindow?: () => void;
  onStatusRequest?: () => { recording: boolean; sessionId?: string | null };
  sendToRenderer?: (channel: string, payload?: unknown) => void;
}

/** A message from the extension's service worker (extension/background.ts). */
interface ExtensionMessage {
  type?: string;
  meetingUrl?: string;
  meetingTitle?: string;
}

/** A message for the extension (`APP_STATUS`, `PROCESSING_PROGRESS`, …). */
interface ExtensionBroadcast {
  type: string;
  [key: string]: unknown;
}

interface ListeningServer {
  wss: WebSocketServer;
  httpServer: http.Server;
  port: number;
}

let wss: WebSocketServer | null = null;
let httpServer: http.Server | null = null;
let extensionSocket: WebSocket | null = null;
const PORT_RANGE = 11; // try port, port+1, ... port+10

/**
 * Try to listen on a single port. Resolves with { wss, httpServer, port } when ready.
 */
function tryListen(port: number, handlers: ExtensionHandlers): Promise<ListeningServer> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = req.url || '/';
      // Allow the extension to raise the window even when the WebSocket is down.
      if (req.method === 'GET' && (url === '/open' || url.startsWith('/open?'))) {
        try {
          handlers.onShowWindow?.();
        } catch (err) {
          logger.error('Failed to show window via /open', { error: errorMessage(err) });
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
function attachHandlers(server: WebSocketServer, port: number, handlers: ExtensionHandlers) {
  server.on('connection', (ws, req) => {
    try {
      const origin = req.headers.origin || '';

      if (!origin.startsWith('chrome-extension://')) {
        logger.warn('Rejected WebSocket connection from unknown origin', { origin });
        ws.close(4001, 'Forbidden');
        return;
      }

      logger.info('Chrome extension connected', { origin });
      extensionSocket = ws;

      if (typeof handlers.sendToRenderer === 'function') {
        handlers.sendToRenderer('ws:extension-connected', { origin });
      }

      ws.on('message', (data: RawData) => {
        try {
          const message: ExtensionMessage = JSON.parse(data.toString());
          handleExtensionMessage(message, ws, handlers);
        } catch (err) {
          logger.error('Failed to parse WebSocket message', { error: errorMessage(err) });
        }
      });

      ws.on('close', () => {
        logger.info('Chrome extension disconnected');
        if (extensionSocket === ws) extensionSocket = null;
      });

      ws.on('error', (err) => {
        logger.error('WebSocket client error', { error: errorMessage(err) });
      });

      try {
        const status = handlers.onStatusRequest?.() || { recording: false, sessionId: null };
        ws.send(JSON.stringify({
          type: 'APP_STATUS',
          recording: !!status.recording,
          sessionId: status.sessionId || null,
        }));
      } catch (err) {
        logger.error('Failed to send status to extension on connection', { error: errorMessage(err) });
      }
    } catch (err) {
      logger.error('Error in WebSocket connection handler', { error: errorMessage(err) });
    }
  });
}

/**
 * Start the WebSocket server. Tries port, then port+1, ... port+10 until one is free.
 */
async function startWebSocketServer(port: number, handlers: ExtensionHandlers): Promise<WebSocketServer> {
  let lastErr: unknown = null;

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
      if (errorCode(err) === 'EADDRINUSE') {
        logger.warn(`Port ${tryPort} in use, trying next...`);
        continue;
      }
      logger.error('WebSocket server error', { error: errorMessage(err) });
      throw err;
    }
  }

  logger.error('WebSocket server failed: all ports in use', {
    ports: `${port}–${port + PORT_RANGE - 1}`,
    hint: 'Close other MeetMind instances or free one of these ports.',
  });
  throw lastErr || new Error('Could not bind WebSocket server');
}

function handleExtensionMessage(message: ExtensionMessage, ws: WebSocket, handlers: ExtensionHandlers) {
  // APP_STATUS is the extension's 10s heartbeat; logging it would flood the log.
  if (message?.type !== 'APP_STATUS') {
    logger.debug('Received extension message', { type: message?.type });
  }

  try {
    switch (message.type) {
      case 'START_RECORDING':
        handlers.onStartRecording?.({
          meetingUrl:   message.meetingUrl   || '',
          meetingTitle: message.meetingTitle || 'Untitled Meeting',
        });
        if (typeof handlers.sendToRenderer === 'function') {
          handlers.sendToRenderer('ws:recording-requested', {
            meetingUrl:   message.meetingUrl,
            meetingTitle: message.meetingTitle,
          });
        }
        break;

      case 'STOP_RECORDING':
        handlers.onStopRecording?.();
        break;

      case 'APP_STATUS': {
        const status = handlers.onStatusRequest?.() || { recording: false, sessionId: null };
        ws.send(JSON.stringify({
          type: 'APP_STATUS',
          recording: !!status.recording,
          sessionId: status.sessionId || null,
        }));
        break;
      }

      case 'SHOW_WINDOW':
        handlers.onShowWindow?.();
        break;

      default:
        logger.warn('Unknown WebSocket message type', { type: message?.type });
    }
  } catch (err) {
    logger.error('Failed to handle extension message', { type: message?.type, error: errorMessage(err) });
  }
}

function broadcastToExtension(message: ExtensionBroadcast) {
  if (!extensionSocket || extensionSocket.readyState !== 1) return;
  try {
    extensionSocket.send(JSON.stringify(message));
  } catch (err) {
    logger.error('Failed to send message to extension', { error: errorMessage(err) });
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

export type { ExtensionHandlers, ExtensionMessage, ExtensionBroadcast };
export { startWebSocketServer, stopWebSocketServer, broadcastToExtension };
