/**
 * MeetMind Content Script
 * Injected into Google Meet and Zoom pages.
 * Manages the overlay iframe lifecycle.
 */

let overlayFrame = null;
let currentMeetingUrl = window.location.href;
let currentMeetingTitle = document.title;

// ── Overlay management ────────────────────────────────────────────────────────

function injectOverlay(config = {}) {
  if (overlayFrame) return; // Already injected

  overlayFrame = document.createElement('iframe');
  overlayFrame.id = 'meetmind-overlay-frame';
  overlayFrame.src = chrome.runtime.getURL('overlay/overlay.html');
  overlayFrame.allow = '';
  overlayFrame.allowFullscreen = false;

  Object.assign(overlayFrame.style, {
    position:    'fixed',
    bottom:      '24px',
    right:       '24px',
    width:       '320px',
    height:      '80px',
    border:      'none',
    borderRadius: '16px',
    zIndex:      '2147483647',
    background:  'transparent',
    boxShadow:   '0 8px 32px rgba(0,0,0,0.4)',
    transition:  'height 0.3s ease',
    pointerEvents: 'auto',
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
  }
}

function sendToOverlay(message) {
  if (!overlayFrame?.contentWindow) return;
  overlayFrame.contentWindow.postMessage(message, '*');
}

function resizeOverlay(height) {
  if (overlayFrame) overlayFrame.style.height = `${height}px`;
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
      if (message.state === 'PROCESSING' || message.state === 'COMPLETE') {
        resizeOverlay(message.state === 'COMPLETE' ? 120 : 140);
      } else {
        resizeOverlay(80);
      }
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
      resizeOverlay(msg.height);
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
