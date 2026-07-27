/**
 * MeetMind Content Script
 * Injected into Google Meet and Zoom pages.
 * Manages the overlay iframe lifecycle.
 */

let overlayFrame = null;
let currentMeetingUrl = window.location.href;
let currentMeetingTitle = document.title;
let overlayCollapsed = false;
let overlayWidth = 160;
let overlayHeight = 52;

// Shared baseline above Meet's bottom toolbar — both expanded pill and
// minimized dock anchor to this so they share the same Y position.
const BOTTOM_OFFSET = 88;
const BAR_HEIGHT = 52;
const COLLAPSED_RADIUS = '14px 0 0 14px';

function important(prop, value) {
  if (!overlayFrame) return;
  overlayFrame.style.setProperty(prop, value, 'important');
}

function applyOverlayBox() {
  if (!overlayFrame) return;

  const left = Math.max(0, window.innerWidth - overlayWidth);

  important('position', 'fixed');
  important('top', 'auto');
  important('bottom', `${BOTTOM_OFFSET}px`);
  important('left', `${left}px`);
  important('right', 'auto');
  important('width', `${overlayWidth}px`);
  important('height', `${overlayHeight}px`);
  important('max-width', `${overlayWidth}px`);
  important('min-width', `${overlayWidth}px`);
  important('max-height', `${overlayHeight}px`);
  important('min-height', `${overlayHeight}px`);
  important('border-radius', overlayCollapsed ? COLLAPSED_RADIUS : '0');
  important('margin', '0');
  important('padding', '0');
  important('border', '0');
  important('outline', 'none');
  important('box-shadow', 'none');
  important('background', 'transparent');
  important('background-color', 'transparent');
  important('overflow', 'hidden');
  important('z-index', '2147483647');
  important('pointer-events', 'auto');
  important('transform', 'none');
  important(
    'transition',
    'width 0.2s ease, max-width 0.2s ease, min-width 0.2s ease, left 0.2s ease, height 0.2s ease',
  );
}

window.addEventListener('resize', applyOverlayBox);

// ── Overlay management ────────────────────────────────────────────────────────

function injectOverlay(config = {}) {
  if (overlayFrame) return; // Already injected

  overlayFrame = document.createElement('iframe');
  overlayFrame.id = 'meetmind-overlay-frame';
  overlayFrame.src = chrome.runtime.getURL('overlay/overlay.html');
  overlayFrame.allow = '';
  overlayFrame.allowFullscreen = false;
  overlayFrame.style.colorScheme = 'dark';

  overlayWidth = 160;
  overlayHeight = BAR_HEIGHT;
  overlayCollapsed = false;

  (document.documentElement || document.body).appendChild(overlayFrame);
  applyOverlayBox();

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

function resizeOverlay(height, width, collapsed) {
  if (!overlayFrame) return;

  if (typeof collapsed === 'boolean') {
    overlayCollapsed = collapsed;
  } else if (width && width <= 52) {
    overlayCollapsed = true;
  }

  if (width) overlayWidth = width;
  if (height) overlayHeight = height;
  else if (!overlayCollapsed) overlayHeight = BAR_HEIGHT;

  applyOverlayBox();
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
  if (!event.data || typeof event.data !== 'object') return;
  if (overlayFrame && event.source !== overlayFrame.contentWindow) return;

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
