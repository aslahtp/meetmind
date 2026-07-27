/**
 * MeetMind Background Service Worker
 *
 * Responsibilities:
 * - Detect active Google Meet / Zoom tabs
 * - Maintain WebSocket connection to the desktop app
 * - Relay messages between content scripts and the desktop app
 * - Manage extension badge state
 */

const WS_PORT_START = 39842;
const WS_PORT_RANGE = 11;   // try 39842–39852 (desktop app uses first free port)
const HEARTBEAT_INTERVAL_MS = 10000;
const RECONNECT_DELAY_MS = 5000;

let ws = null;
let wsConnected = false;
let reconnectTimer = null;
let heartbeatTimer = null;
let activeMeetingTabId = null;
let currentPort = WS_PORT_START;

// ── WebSocket ─────────────────────────────────────────────────────────────────

function connectWebSocket() {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;

  try {
    ws = new WebSocket(`ws://localhost:${currentPort}`);
  } catch {
    tryNextPort();
    return;
  }

  ws.onopen = () => {
    wsConnected = true;
    clearTimeout(reconnectTimer);
    console.log('[MeetMind] Connected to desktop app');
    updateBadge('connected');
    startHeartbeat();

    // Notify all active meeting tabs
    if (activeMeetingTabId) {
      sendToContentScript(activeMeetingTabId, { type: 'WS_CONNECTED' });
    }
  };

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      handleDesktopMessage(msg);
    } catch {
      // ignore parse errors
    }
  };

  ws.onerror = () => {
    wsConnected = false;
  };

  ws.onclose = () => {
    const wasConnected = wsConnected;
    wsConnected = false;
    stopHeartbeat();
    updateBadge('disconnected');

    if (activeMeetingTabId) {
      sendToContentScript(activeMeetingTabId, { type: 'APP_OFFLINE' });
    }

    if (wasConnected) {
      currentPort = WS_PORT_START;
      scheduleReconnect();
    } else {
      tryNextPort();
    }
  };
}

function tryNextPort() {
  const nextPort = currentPort + 1;
  if (nextPort < WS_PORT_START + WS_PORT_RANGE) {
    currentPort = nextPort;
    connectWebSocket();
  } else {
    currentPort = WS_PORT_START;
    scheduleReconnect();
  }
}

function scheduleReconnect() {
  clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(connectWebSocket, RECONNECT_DELAY_MS);
}

function startHeartbeat() {
  stopHeartbeat();
  heartbeatTimer = setInterval(() => {
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'APP_STATUS' }));
    } else {
      connectWebSocket();
    }
  }, HEARTBEAT_INTERVAL_MS);
}

function stopHeartbeat() {
  clearInterval(heartbeatTimer);
}

function sendToDesktop(message) {
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
    return true;
  }
  return false;
}

let pendingOpenAppTabId = null;
let launchRetryTimer = null;

async function tryHttpOpenApp() {
  for (let i = 0; i < WS_PORT_RANGE; i++) {
    const port = WS_PORT_START + i;
    try {
      const res = await fetch(`http://127.0.0.1:${port}/open`, { method: 'GET' });
      if (res.ok) {
        currentPort = port;
        return true;
      }
    } catch {
      // App not listening on this port
    }
  }
  return false;
}

function openProtocolBridgeTab() {
  const openPage = chrome.runtime.getURL('open-app.html');

  chrome.tabs.create({ url: openPage, active: true }, (tab) => {
    if (chrome.runtime.lastError) {
      console.warn('[MeetMind] Failed to open app bridge tab:', chrome.runtime.lastError.message);
      return;
    }
    if (tab?.id != null) {
      pendingOpenAppTabId = tab.id;
    }
  });
}

async function launchDesktopApp() {
  // 1) If the desktop app is already running (tray), raise it over HTTP.
  const raised = await tryHttpOpenApp();
  if (raised) {
    console.log('[MeetMind] Raised desktop app via HTTP /open');
    connectWebSocket();
    return;
  }

  // 2) Otherwise hand off via meetmind:// (Chrome blocks this in chrome.tabs.create).
  openProtocolBridgeTab();

  // App may take a moment to start — keep trying the WebSocket.
  let attempts = 0;
  clearInterval(launchRetryTimer);
  launchRetryTimer = setInterval(() => {
    attempts += 1;
    if (wsConnected || attempts >= 24) {
      clearInterval(launchRetryTimer);
      launchRetryTimer = null;
      return;
    }
    connectWebSocket();
  }, 500);
}

function closeOpenAppTab() {
  if (pendingOpenAppTabId == null) return;
  const tabId = pendingOpenAppTabId;
  pendingOpenAppTabId = null;
  chrome.tabs.remove(tabId).catch(() => {});
}

// ── Handle messages from desktop app ─────────────────────────────────────────

function handleDesktopMessage(msg) {
  console.log('[MeetMind] Desktop message:', msg.type);

  switch (msg.type) {
    case 'APP_STATUS':
      updateBadge('connected');
      if (activeMeetingTabId) {
        sendToContentScript(activeMeetingTabId, { type: 'APP_STATUS', recording: msg.recording });
      }
      break;

    case 'RECORDING_STARTED':
      updateBadge('recording');
      if (activeMeetingTabId) {
        sendToContentScript(activeMeetingTabId, {
          type: 'UPDATE_OVERLAY',
          state: 'RECORDING',
          sessionId: msg.sessionId,
        });
      }
      break;

    case 'RECORDING_STOPPED':
      updateBadge('connected');
      if (activeMeetingTabId) {
        sendToContentScript(activeMeetingTabId, {
          type: 'UPDATE_OVERLAY',
          state: 'PROCESSING',
        });
      }
      break;

    case 'PROCESSING_PROGRESS':
      if (activeMeetingTabId) {
        sendToContentScript(activeMeetingTabId, {
          type: 'UPDATE_OVERLAY',
          state: 'PROCESSING',
          stage: msg.stage,
          percent: msg.percent,
        });
      }
      break;

    case 'PROCESSING_COMPLETE':
      if (activeMeetingTabId) {
        sendToContentScript(activeMeetingTabId, {
          type: 'UPDATE_OVERLAY',
          state: 'COMPLETE',
          notionUrl: msg.notionUrl,
          sessionId: msg.sessionId,
        });
      }
      break;

    case 'PROCESSING_ERROR':
      if (activeMeetingTabId) {
        sendToContentScript(activeMeetingTabId, {
          type: 'UPDATE_OVERLAY',
          state: 'ERROR',
          error: msg.error,
        });
      }
      break;
  }
}

// ── Badge management ──────────────────────────────────────────────────────────

function updateBadge(state) {
  const badges = {
    connected:    { text: '',   color: '#22c55e', title: 'MeetMind — Connected'     },
    disconnected: { text: '!',  color: '#6b7280', title: 'MeetMind — App not running' },
    recording:    { text: 'REC', color: '#ef4444', title: 'MeetMind — Recording'    },
    meeting:      { text: '●',  color: '#22c55e', title: 'MeetMind — Meeting detected' },
  };

  const b = badges[state] || badges.disconnected;
  chrome.action.setBadgeText({ text: b.text });
  chrome.action.setBadgeBackgroundColor({ color: b.color });
  chrome.action.setTitle({ title: b.title });
}

// ── Tab detection ─────────────────────────────────────────────────────────────

function isMeetingUrl(url) {
  if (!url) return false;
  return (
    url.includes('meet.google.com/') ||
    url.match(/zoom\.us\/(wc|j)\/\d+/)
  );
}

function getMeetingPlatform(url) {
  if (url.includes('meet.google.com')) return 'Google Meet';
  if (url.includes('zoom.us')) return 'Zoom';
  return 'Meeting';
}

function sendToContentScript(tabId, message) {
  chrome.tabs.sendMessage(tabId, message).catch(() => {
    // Tab may have been closed or content script not ready
  });
}

// Tab updated
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete') return;

  if (isMeetingUrl(tab.url)) {
    activeMeetingTabId = tabId;
    const platform = getMeetingPlatform(tab.url);

    console.log('[MeetMind] Meeting detected:', tab.url);
    updateBadge(wsConnected ? 'meeting' : 'disconnected');

    // Connect to desktop app if not already
    connectWebSocket();

    // Notify desktop
    sendToDesktop({
      type: 'MEETING_DETECTED',
      url: tab.url,
      title: tab.title || platform,
      platform,
    });

    // Inject overlay into the meeting tab
    setTimeout(() => {
      sendToContentScript(tabId, {
        type: 'INJECT_OVERLAY',
        meetingUrl: tab.url,
        meetingTitle: tab.title || platform,
        appConnected: wsConnected,
      });
    }, 2000); // Wait for meeting UI to load

  } else if (tabId === activeMeetingTabId) {
    // Meeting tab navigated away
    activeMeetingTabId = null;
    sendToDesktop({ type: 'MEETING_ENDED' });
    updateBadge(wsConnected ? 'connected' : 'disconnected');
  }
});

// Tab closed
chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabId === activeMeetingTabId) {
    activeMeetingTabId = null;
    sendToDesktop({ type: 'MEETING_ENDED' });
    updateBadge(wsConnected ? 'connected' : 'disconnected');
  }
});

// Messages from content script / overlay
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('[MeetMind] Content message:', message.type);

  switch (message.type) {
    case 'START_RECORDING': {
      const sent = sendToDesktop({
        type: 'START_RECORDING',
        meetingUrl:   message.meetingUrl,
        meetingTitle: message.meetingTitle,
      });
      sendResponse({ success: sent, wsConnected });
      break;
    }

    case 'STOP_RECORDING': {
      const sent = sendToDesktop({ type: 'STOP_RECORDING' });
      sendResponse({ success: sent });
      break;
    }

    case 'GET_STATUS': {
      sendResponse({ wsConnected, activeMeetingTabId });
      break;
    }

    case 'OPEN_APP': {
      if (wsConnected) {
        const sent = sendToDesktop({ type: 'SHOW_WINDOW' });
        // Also try protocol in case the socket is stale / window is hard to raise.
        if (!sent) launchDesktopApp();
      } else {
        launchDesktopApp();
      }
      sendResponse({ success: true });
      break;
    }

    case 'CLOSE_OPEN_APP_TAB': {
      closeOpenAppTab();
      sendResponse({ success: true });
      break;
    }
  }

  return true; // Keep message channel open for async response
});

// Initialize on service worker start
connectWebSocket();
updateBadge('disconnected');
