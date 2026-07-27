'use strict';

const PROTOCOL_URL = 'meetmind://open';
const statusEl = document.getElementById('status');
const hintEl = document.getElementById('hint');
const launchEl = document.getElementById('launch');

function openProtocol() {
  try {
    launchEl.click();
  } catch (_) {
    window.location.href = PROTOCOL_URL;
  }
}

launchEl.addEventListener('click', () => {
  statusEl.textContent = 'Launching MeetMind…';
});

openProtocol();

setTimeout(() => {
  statusEl.textContent = 'Waiting for MeetMind…';
  hintEl.hidden = false;
}, 800);

// Close helper tab quickly once the OS has the protocol request.
setTimeout(() => {
  chrome.runtime.sendMessage({ type: 'CLOSE_OPEN_APP_TAB' }).catch(() => {});
}, 1500);
