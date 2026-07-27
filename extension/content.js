/**
 * MeetMind Content Script
 * Injected into Google Meet and Zoom pages.
 * Manages the overlay iframe lifecycle.
 */

let overlayFrame = null;
let currentMeetingUrl = window.location.href;
let currentMeetingTitle = document.title;
let overlayCollapsed = false;

const EXPANDED_STYLE = {
  bottom: '100px',
  right: '16px',
  left: 'auto',
  top: 'auto',
  transform: 'none',
  borderRadius: '16px',
};

const COLLAPSED_STYLE = {
  bottom: 'auto',
  left: 'auto',
  right: '0',
  top: '50%',
  transform: 'translateY(-50%)',
  borderRadius: '16px 0 0 16px',
};

// ── Overlay management ────────────────────────────────────────────────────────

function injectOverlay(config = {}) {
  if (overlayFrame) return; // Already injected

  overlayFrame = document.createElement('iframe');
  overlayFrame.id = 'meetmind-overlay-frame';
  overlayFrame.src = chrome.runtime.getURL('overlay/overlay.html');
  overlayFrame.allow = '';
  overlayFrame.allowFullscreen = false;

  Object.assign(overlayFrame.style, {
    position:      'fixed',
    width:         '360px',
    height:        '64px',
    border:        'none',
    zIndex:        '2147483647',
    background:    'transparent',
    boxShadow:     'none',
    overflow:      'hidden',
    transition:    'height 0.25s cubic-bezier(0.22, 1, 0.36, 1), width 0.25s ease, top 0.25s ease, bottom 0.25s ease, left 0.25s ease, right 0.25s ease, transform 0.25s ease, border-radius 0.2s ease',
    pointerEvents: 'auto',
    colorScheme:   'dark',
    ...EXPANDED_STYLE,
  });

  document.body.appendChild(overlayFrame);

  // Once loaded, send initial state
  overlayFrame.addEventListener('load', () => {
    sendToOverlay({
      type: 'INIT',
      meetingUrl:   config.meetingUrl   || currentMeetingUrl,
      meetingTitle: config.meetingTitle || currentMeetingTitle,
      appConnected: config.appConnected || false,
    });
  });
}

function removeOverlay() {
  if (overlayFrame) {
    overlayFrame.remove();
    overlayFrame = null;
    overlayCollapsed = false;
  }
}

function sendToOverlay(message) {
  if (!overlayFrame?.contentWindow) return;
  overlayFrame.contentWindow.postMessage(message, '*');
}

function applyDockPosition(collapsed) {
  if (!overlayFrame) return;
  overlayCollapsed = !!collapsed;

  // Reset all anchor props so collapsed ↔ expanded never leave stale values
  overlayFrame.style.top = 'auto';
  overlayFrame.style.bottom = 'auto';
  overlayFrame.style.left = 'auto';
  overlayFrame.style.right = 'auto';
  overlayFrame.style.transform = 'none';

  Object.assign(overlayFrame.style, overlayCollapsed ? COLLAPSED_STYLE : EXPANDED_STYLE);
}

function resizeOverlay(height, width, collapsed) {
  if (!overlayFrame) return;
  if (typeof collapsed === 'boolean') applyDockPosition(collapsed);
  overlayFrame.style.height = `${Math.max(overlayCollapsed ? 52 : 56, height)}px`;
  if (width) overlayFrame.style.width = `${width}px`;
}

// ── Messages from background service worker ───────────────────────────────────

chrome.runtime.onMessage.addListener((message) => {
  switch (message.type) {
    case 'INJECT_OVERLAY':
      injectOverlay({
        meetingUrl:   message.meetingUrl,
        meetingTitle: message.meetingTitle,
        appConnected: message.appConnected,
      });
      break;

    case 'REMOVE_OVERLAY':
      removeOverlay();
      break;

    case 'UPDATE_OVERLAY':
      sendToOverlay(message);
      break;

    case 'WS_CONNECTED':
      sendToOverlay({ type: 'APP_CONNECTED' });
      break;

    case 'APP_OFFLINE':
      sendToOverlay({ type: 'APP_OFFLINE' });
      break;

    case 'APP_STATUS':
      sendToOverlay({ type: 'APP_STATUS', recording: message.recording });
      break;
  }
});

// ── Messages from overlay iframe (postMessage) ────────────────────────────────

window.addEventListener('message', (event) => {
  // Only accept messages from our own extension overlay
  if (!event.data || typeof event.data !== 'object') return;

  const msg = event.data;

  switch (msg.type) {
    case 'OVERLAY_START_RECORDING':
      chrome.runtime.sendMessage({
        type: 'START_RECORDING',
        meetingUrl:   currentMeetingUrl,
        meetingTitle: currentMeetingTitle,
      });
      break;

    case 'OVERLAY_STOP_RECORDING':
      chrome.runtime.sendMessage({ type: 'STOP_RECORDING' });
      break;

    case 'OVERLAY_OPEN_APP':
      chrome.runtime.sendMessage({ type: 'OPEN_APP' });
      break;

    case 'OVERLAY_RESIZE':
      resizeOverlay(msg.height, msg.width, msg.collapsed);
      break;

    case 'OVERLAY_DISMISS':
      removeOverlay();
      break;
  }
});

// ── Auto-inject if we're on a meeting page ────────────────────────────────────

function checkAndInject() {
  const url = window.location.href;
  if (
    url.includes('meet.google.com/') ||
    url.match(/zoom\.us\/(wc|j)\/\d+/)
  ) {
    // Wait a bit for meeting UI to load
    setTimeout(() => {
      chrome.runtime.sendMessage({ type: 'GET_STATUS' }, (status) => {
        injectOverlay({
          meetingUrl:   url,
          meetingTitle: document.title,
          appConnected: status?.wsConnected || false,
        });
      });
    }, 3000);
  }
}

checkAndInject();
