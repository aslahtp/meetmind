'use strict';

const PROTOCOL_URL = 'meetmind://open';
const statusEl = document.getElementById('status');
const hintEl = document.getElementById('hint');
const launchEl = document.getElementById('launch');

function openProtocol() {
  // Chrome blocks meetmind:// in chrome.tabs.create from the service worker.
  // Navigating from this extension page is the reliable handoff.
  try {
    window.location.href = PROTOCOL_URL;
  } catch (_) {
    launchEl.click();
  }
}

openProtocol();

setTimeout(() => {
  statusEl.textContent = 'Waiting for MeetMind…';
  hintEl.hidden = false;
}, 1200);

// Ask the background to close this helper tab after the OS handles the protocol.
setTimeout(() => {
  chrome.runtime.sendMessage({ type: 'CLOSE_OPEN_APP_TAB' }).catch(() => {});
}, 2500);
