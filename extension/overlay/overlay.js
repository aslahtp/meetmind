/**
 * MeetMind Overlay Script
 *
 * Runs inside the overlay iframe injected into Meet/Zoom pages.
 * Manages 5 UI states: IDLE → RECORDING → PROCESSING → COMPLETE → APP_OFFLINE
 */

'use strict';

// ── State ─────────────────────────────────────────────────────────────────────

const State = Object.freeze({
  IDLE:        'IDLE',
  RECORDING:   'RECORDING',
  PROCESSING:  'PROCESSING',
  COMPLETE:    'COMPLETE',
  APP_OFFLINE: 'APP_OFFLINE',
});

let currentState = State.APP_OFFLINE;
let meetingUrl   = '';
let meetingTitle = '';
let notionUrl    = null;
let sessionId    = null;
let timerSeconds = 0;
let timerInterval = null;
let processingStage  = '';
let processingPercent = 0;
let dismissTimer = null;
let dismissSeconds = 10;

const root = document.getElementById('overlay-root');

// ── Render ────────────────────────────────────────────────────────────────────

function render() {
  root.innerHTML = '';
  const el = buildUI();
  if (el) root.appendChild(el);
  requestResize();
}

function requestResize() {
  const height = root.scrollHeight + 4;
  window.parent.postMessage({ type: 'OVERLAY_RESIZE', height: Math.max(60, height) }, '*');
}

function buildUI() {
  switch (currentState) {
    case State.APP_OFFLINE:  return buildOfflineUI();
    case State.IDLE:         return buildIdleUI();
    case State.RECORDING:    return buildRecordingUI();
    case State.PROCESSING:   return buildProcessingUI();
    case State.COMPLETE:     return buildCompleteUI();
    default:                 return null;
  }
}

// ── IDLE ──────────────────────────────────────────────────────────────────────

function buildIdleUI() {
  const pill = el('div', { class: 'pill' });

  const dot  = el('span', { class: 'dot idle' });
  const lbl  = el('span', { class: 'state-label', style: 'color:#888' }, 'Ready to record');
  const btn  = el('button', { class: 'btn btn-start' }, '⏺ Start Recording');

  btn.addEventListener('click', startRecording);

  pill.append(dot, lbl, btn);
  return pill;
}

// ── RECORDING ─────────────────────────────────────────────────────────────────

function buildRecordingUI() {
  const pill = el('div', { class: 'pill' });

  const dot  = el('span', { class: 'dot recording' });
  const lbl  = el('span', { class: 'state-label' }, 'Recording');
  const time = el('span', { class: 'timer', id: 'timer-display' }, formatTime(timerSeconds));
  const btn  = el('button', { class: 'btn btn-stop' });

  const stopIcon = svgSquare();
  btn.appendChild(stopIcon);
  btn.appendChild(document.createTextNode(' Stop'));
  btn.addEventListener('click', stopRecording);

  pill.append(dot, lbl, time, btn);
  return pill;
}

// ── PROCESSING ────────────────────────────────────────────────────────────────

function buildProcessingUI() {
  const pill = el('div', { class: 'pill expanded' });

  const row1 = el('div', { class: 'row' });
  const spinner = el('div', { class: 'spinner' });
  const lbl = el('span', { class: 'state-label' }, 'Processing notes…');
  const pct = el('span', { class: 'pct-text' }, `${Math.round(processingPercent)}%`);
  row1.append(spinner, lbl, pct);

  const stageLabels = {
    transcribing: '🎙️ Transcribing audio…',
    generating:   '🧠 Generating notes…',
    uploading:    '📤 Uploading to Notion…',
    complete:     '✅ Almost done…',
  };

  const row2 = el('div', { class: 'col', style: 'gap:4px' });
  const stageTxt = el('span', { class: 'stage-text' }, stageLabels[processingStage] || '⚙️ Processing…');
  const track    = el('div', { class: 'progress-bar-track' });
  const fill     = el('div', {
    class: 'progress-bar-fill',
    style: `width:${Math.min(100, processingPercent)}%`,
  });
  track.appendChild(fill);
  row2.append(stageTxt, track);

  pill.append(row1, row2);
  return pill;
}

// ── COMPLETE ──────────────────────────────────────────────────────────────────

function buildCompleteUI() {
  const pill = el('div', { class: 'pill expanded' });

  // Close button
  const closeBtn = el('button', { class: 'close-btn', title: 'Dismiss' }, '×');
  closeBtn.style.position = 'absolute';
  closeBtn.style.top = '6px';
  closeBtn.style.right = '8px';
  closeBtn.addEventListener('click', () => {
    clearTimeout(dismissTimer);
    window.parent.postMessage({ type: 'OVERLAY_DISMISS' }, '*');
  });
  pill.style.position = 'relative';
  pill.appendChild(closeBtn);

  const row1 = el('div', { class: 'row' });
  const checkIcon = el('div', { class: 'check-icon' });
  checkIcon.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>`;
  const lbl = el('span', { class: 'state-label' }, 'Notes ready!');
  row1.append(checkIcon, lbl);

  const row2 = el('div', { class: 'row', style: 'gap:6px;flex-wrap:wrap' });

  if (notionUrl) {
    const notionBtn = el('button', { class: 'btn btn-notion' }, '📄 Open in Notion ↗');
    notionBtn.addEventListener('click', () => window.open(notionUrl, '_blank'));
    row2.appendChild(notionBtn);
  }

  const appBtn = el('button', { class: 'btn btn-ghost' }, '🖥 View in App');
  appBtn.addEventListener('click', () => window.parent.postMessage({ type: 'OVERLAY_OPEN_APP' }, '*'));
  row2.appendChild(appBtn);

  // Auto-dismiss bar
  const dismissBarTrack = el('div', { class: 'progress-bar-track' });
  const dismissBarFill  = el('div', {
    class: 'dismiss-bar',
    id: 'dismiss-bar',
    style: 'width:100%',
  });
  dismissBarTrack.appendChild(dismissBarFill);

  pill.append(row1, row2, dismissBarTrack);

  // Start dismiss countdown
  startDismissCountdown();

  return pill;
}

function startDismissCountdown() {
  let remaining = dismissSeconds;
  const tick = () => {
    remaining--;
    const fill = document.getElementById('dismiss-bar');
    if (fill) fill.style.width = `${(remaining / dismissSeconds) * 100}%`;
    if (remaining <= 0) {
      window.parent.postMessage({ type: 'OVERLAY_DISMISS' }, '*');
    } else {
      dismissTimer = setTimeout(tick, 1000);
    }
  };
  dismissTimer = setTimeout(tick, 1000);
}

// ── APP OFFLINE ───────────────────────────────────────────────────────────────

function buildOfflineUI() {
  const pill = el('div', { class: 'pill' });

  const dot = el('span', { class: 'dot offline' });
  const lbl = el('span', { class: 'state-label offline-warning' }, '⚠ MeetMind not running');
  const btn = el('button', { class: 'btn btn-download' }, '⬇ Download');
  btn.addEventListener('click', () => window.open('https://github.com/meetmind/meetmind/releases', '_blank'));

  pill.append(dot, lbl, btn);
  return pill;
}

// ── Timer ─────────────────────────────────────────────────────────────────────

function startTimer() {
  stopTimer();
  timerSeconds = 0;
  timerInterval = setInterval(() => {
    timerSeconds++;
    const display = document.getElementById('timer-display');
    if (display) display.textContent = formatTime(timerSeconds);
  }, 1000);
}

function stopTimer() {
  clearInterval(timerInterval);
  timerSeconds = 0;
}

function formatTime(secs) {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60).toString().padStart(2, '0');
  const s = (secs % 60).toString().padStart(2, '0');
  return h > 0 ? `${h}:${m}:${s}` : `${m}:${s}`;
}

// ── Actions ───────────────────────────────────────────────────────────────────

function startRecording() {
  window.parent.postMessage({
    type: 'OVERLAY_START_RECORDING',
    meetingUrl,
    meetingTitle,
  }, '*');
}

function stopRecording() {
  window.parent.postMessage({ type: 'OVERLAY_STOP_RECORDING' }, '*');
}

// ── Message handler ───────────────────────────────────────────────────────────

window.addEventListener('message', (event) => {
  const msg = event.data;
  if (!msg || typeof msg !== 'object') return;

  switch (msg.type) {
    case 'INIT':
      meetingUrl   = msg.meetingUrl   || '';
      meetingTitle = msg.meetingTitle || 'Meeting';
      currentState = msg.appConnected ? State.IDLE : State.APP_OFFLINE;
      render();
      break;

    case 'APP_CONNECTED':
      if (currentState === State.APP_OFFLINE) {
        currentState = State.IDLE;
        render();
      }
      break;

    case 'APP_OFFLINE':
      currentState = State.APP_OFFLINE;
      stopTimer();
      render();
      break;

    case 'APP_STATUS':
      if (msg.recording) {
        if (currentState !== State.RECORDING) {
          currentState = State.RECORDING;
          startTimer();
          render();
        }
      } else if (currentState === State.APP_OFFLINE) {
        currentState = State.IDLE;
        render();
      }
      break;

    case 'UPDATE_OVERLAY':
      switch (msg.state) {
        case 'RECORDING':
          if (currentState !== State.RECORDING) {
            currentState = State.RECORDING;
            sessionId = msg.sessionId;
            startTimer();
            render();
          }
          break;

        case 'PROCESSING':
          stopTimer();
          currentState = State.PROCESSING;
          processingStage   = msg.stage   || 'transcribing';
          processingPercent = msg.percent || 0;
          render();
          break;

        case 'COMPLETE':
          currentState = State.COMPLETE;
          notionUrl  = msg.notionUrl  || null;
          sessionId  = msg.sessionId || null;
          render();
          break;

        case 'ERROR':
          currentState = State.IDLE;
          render();
          break;
      }
      break;
  }
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function el(tag, attrs = {}, text = '') {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else node.setAttribute(k, v);
  }
  if (text) node.textContent = text;
  return node;
}

function svgSquare() {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', '8');
  svg.setAttribute('height', '8');
  svg.setAttribute('viewBox', '0 0 10 10');
  const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  rect.setAttribute('width', '10');
  rect.setAttribute('height', '10');
  rect.setAttribute('fill', 'currentColor');
  svg.appendChild(rect);
  return svg;
}

// Initial render
render();
