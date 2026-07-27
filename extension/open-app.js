'use strict';

const PROTOCOL_URL = 'meetmind://open';
const statusEl = document.getElementById('status');
const hintEl = document.getElementById('hint');
const launchEl = document.getElementById('launch');

function openProtocol() {
  // Prefer a real user-activated <a> click — most reliable in Chrome.
  try {
    launchEl.click();
  } catch (_) {
    window.location.href = PROTOCOL_URL;
  }

  // Fallback iframe handoff (some Chrome builds ignore location.assign for custom schemes)
  try {
    const iframe = document.createElement('iframe');
    iframe.style.display = 'none';
    iframe.src = PROTOCOL_URL;
    document.body.appendChild(iframe);
    setTimeout(() => iframe.remove(), 2000);
  } catch (_) {
    // ignore
  }
}

launchEl.addEventListener('click', () => {
  statusEl.textContent = 'Launching MeetMind…';
});

openProtocol();

setTimeout(() => {
  statusEl.textContent = 'Waiting for MeetMind…';
  hintEl.hidden = false;
}, 1000);

// Keep the tab briefly so Chrome can show the external-protocol prompt.
setTimeout(() => {
  chrome.runtime.sendMessage({ type: 'CLOSE_OPEN_APP_TAB' }).catch(() => {});
}, 8000);
