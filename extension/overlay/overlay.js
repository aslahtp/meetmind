/**
 * MeetMind Overlay Script
 *
 * Runs inside the overlay iframe injected into Meet/Zoom pages.
 * Manages 5 UI states: IDLE → RECORDING → PROCESSING → COMPLETE → APP_OFFLINE
 */

'use strict';

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
let collapsed = false;

try {
  collapsed = sessionStorage.getItem('meetmind-overlay-collapsed') === '1';
} catch (_) {
  collapsed = false;
}

const root = document.getElementById('overlay-root');

// ── Render ────────────────────────────────────────────────────────────────────

function render() {
  root.innerHTML = '';
  root.classList.toggle('docked', collapsed);
  const node = collapsed ? buildDockUI() : buildUI();
  if (node) root.appendChild(node);
  requestResize();
}

function requestResize() {
  if (collapsed) {
    window.parent.postMessage({
      type: 'OVERLAY_RESIZE',
      height: 56,
      width: 48,
      collapsed: true,
    }, '*');
    return;
  }

  const height = Math.ceil(root.scrollHeight + 4);
  const width = currentState === State.RECORDING ? 420
    : currentState === State.COMPLETE ? 360
    : currentState === State.PROCESSING ? 340
    : 360;
  window.parent.postMessage({
    type: 'OVERLAY_RESIZE',
    height: Math.max(56, height),
    width,
    collapsed: false,
  }, '*');
}

function setCollapsed(next) {
  collapsed = !!next;
  try {
    sessionStorage.setItem('meetmind-overlay-collapsed', collapsed ? '1' : '0');
  } catch (_) { /* ignore */ }

  if (collapsed) {
    clearTimeout(dismissTimer);
    dismissTimer = null;
  }

  render();
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

// ── Collapsed dock (right wall) ───────────────────────────────────────────────

function buildDockUI() {
  const isRecording = currentState === State.RECORDING;
  const isProcessing = currentState === State.PROCESSING;
  const isOffline = currentState === State.APP_OFFLINE;
  const isComplete = currentState === State.COMPLETE;

  let dockClass = 'dock';
  if (isRecording) dockClass += ' recording-active';
  if (isProcessing) dockClass += ' processing-active';

  const dock = el('button', {
    class: dockClass,
    type: 'button',
    title: 'Show MeetMind',
    'aria-label': 'Show MeetMind overlay',
  });

  let markVariant = '';
  if (isRecording) markVariant = 'recording';
  else if (isOffline) markVariant = 'muted';
  else if (isComplete) markVariant = 'success';

  const mark = el('div', { class: markVariant ? `dock-mark ${markVariant}` : 'dock-mark' });
  if (isComplete) mark.appendChild(iconCheck(11));
  else mark.appendChild(iconMic(12));

  let statusClass = 'dock-status idle';
  if (isRecording) statusClass = 'dock-status recording';
  else if (isProcessing) statusClass = 'dock-status processing';
  else if (isOffline) statusClass = 'dock-status offline';
  else if (isComplete) statusClass = 'dock-status complete';

  const status = el('span', { class: statusClass, 'aria-hidden': 'true' });

  dock.append(mark, status);
  dock.addEventListener('click', () => setCollapsed(false));
  return dock;
}

function addMinimizeControl(pill, { dismiss = false } = {}) {
  pill.classList.add('has-controls');
  const controls = el('div', { class: 'pill-controls' });

  const hideBtn = el('button', {
    class: 'icon-btn',
    type: 'button',
    title: 'Hide to edge',
    'aria-label': 'Hide overlay to right edge',
  });
  hideBtn.appendChild(iconDock(12));
  hideBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    setCollapsed(true);
  });
  controls.appendChild(hideBtn);

  if (dismiss) {
    const closeBtn = el('button', {
      class: 'icon-btn',
      type: 'button',
      title: 'Dismiss',
      'aria-label': 'Dismiss overlay',
    });
    closeBtn.appendChild(iconClose(12));
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      clearTimeout(dismissTimer);
      window.parent.postMessage({ type: 'OVERLAY_DISMISS' }, '*');
    });
    controls.appendChild(closeBtn);
  }

  pill.appendChild(controls);
  return pill;
}

// ── IDLE ──────────────────────────────────────────────────────────────────────

function buildIdleUI() {
  const pill = el('div', { class: 'pill' });

  const mark = brandMark();
  const copy = el('div', { class: 'col', style: 'gap:1px;flex:1;min-width:0' });
  copy.append(
    el('span', { class: 'state-label' }, 'MeetMind'),
    el('span', { class: 'state-sub' }, 'Ready to capture this meeting'),
  );

  const btn = el('button', { class: 'btn btn-start', title: 'Start recording' });
  btn.append(iconMic(14), document.createTextNode(' Record'));
  btn.addEventListener('click', startRecording);

  pill.append(mark, copy, btn);
  return addMinimizeControl(pill);
}

// ── RECORDING ─────────────────────────────────────────────────────────────────

function buildRecordingUI() {
  const pill = el('div', { class: 'pill recording-active' });

  const mark = brandMark('recording');

  const copy = el('div', { class: 'col', style: 'gap:1px;flex:1;min-width:0' });
  const titleRow = el('div', { class: 'row', style: 'gap:6px' });
  titleRow.append(
    el('span', { class: 'dot recording' }),
    el('span', { class: 'state-label' }, 'Recording'),
  );
  copy.append(titleRow, el('span', { class: 'state-sub' }, 'Capturing audio…'));

  const wave = el('div', { class: 'waveform', 'aria-hidden': 'true' });
  for (let i = 0; i < 5; i++) wave.appendChild(el('div', { class: 'wave-bar' }));

  const time = el('span', { class: 'timer', id: 'timer-display' }, formatTime(timerSeconds));

  const btn = el('button', { class: 'btn btn-stop', title: 'Stop recording' });
  btn.append(iconSquare(8), document.createTextNode(' Stop'));
  btn.addEventListener('click', stopRecording);

  pill.append(mark, copy, wave, time, btn);
  return addMinimizeControl(pill);
}

// ── PROCESSING ────────────────────────────────────────────────────────────────

function buildProcessingUI() {
  const pill = el('div', { class: 'pill expanded' });

  const row1 = el('div', { class: 'row' });
  const spinner = el('div', { class: 'spinner', 'aria-hidden': 'true' });
  const copy = el('div', { class: 'col', style: 'gap:1px;flex:1;min-width:0' });
  copy.append(
    el('span', { class: 'state-label' }, 'Processing notes'),
    el('span', { class: 'stage-text' }, stageLabel(processingStage)),
  );
  const pct = el('span', { class: 'pct-text' }, `${Math.round(processingPercent)}%`);
  row1.append(spinner, copy, pct);

  const track = el('div', { class: 'progress-bar-track' });
  const fill = el('div', {
    class: 'progress-bar-fill',
    style: `width:${Math.min(100, processingPercent)}%`,
  });
  track.appendChild(fill);

  pill.append(row1, track);
  return addMinimizeControl(pill);
}

function stageLabel(stage) {
  const labels = {
    transcribing: 'Transcribing audio…',
    generating:   'Generating notes with AI…',
    uploading:    'Uploading to Notion…',
    complete:     'Almost done…',
  };
  return labels[stage] || 'Working on your meeting…';
}

// ── COMPLETE ──────────────────────────────────────────────────────────────────

function buildCompleteUI() {
  const pill = el('div', { class: 'pill expanded' });

  const row1 = el('div', { class: 'row' });
  const checkIcon = el('div', { class: 'check-icon' });
  checkIcon.appendChild(iconCheck(11));
  const copy = el('div', { class: 'col', style: 'gap:1px;flex:1;min-width:0' });
  copy.append(
    el('span', { class: 'state-label' }, 'Notes ready'),
    el('span', { class: 'state-sub' }, 'Saved and ready to review'),
  );
  row1.append(checkIcon, copy);

  const actions = el('div', { class: 'actions' });

  if (notionUrl) {
    const notionBtn = el('button', { class: 'btn btn-notion' });
    notionBtn.append(iconExternal(12), document.createTextNode(' Open in Notion'));
    notionBtn.addEventListener('click', () => window.open(notionUrl, '_blank'));
    actions.appendChild(notionBtn);
  }

  const appBtn = el('button', { class: 'btn btn-ghost' });
  appBtn.append(iconApp(12), document.createTextNode(' View in App'));
  appBtn.addEventListener('click', () => window.parent.postMessage({ type: 'OVERLAY_OPEN_APP' }, '*'));
  actions.appendChild(appBtn);

  const dismissTrack = el('div', { class: 'progress-bar-track' });
  const dismissFill = el('div', {
    class: 'dismiss-bar',
    id: 'dismiss-bar',
    style: 'width:100%',
  });
  dismissTrack.appendChild(dismissFill);

  pill.append(row1, actions, dismissTrack);
  addMinimizeControl(pill, { dismiss: true });
  startDismissCountdown();
  return pill;
}

function startDismissCountdown() {
  clearTimeout(dismissTimer);
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

  const mark = brandMark('muted');
  mark.appendChild(iconMic(12));

  const copy = el('div', { class: 'col', style: 'gap:1px;flex:1;min-width:0' });
  const titleRow = el('div', { class: 'row', style: 'gap:6px' });
  titleRow.append(
    el('span', { class: 'dot offline' }),
    el('span', { class: 'state-label warning' }, 'App not running'),
  );
  copy.append(titleRow, el('span', { class: 'state-sub' }, 'Open MeetMind to start recording'));

  const btn = el('button', { class: 'btn btn-download' });
  btn.append(iconDownload(12), document.createTextNode(' Get App'));
  btn.addEventListener('click', () => window.open('https://github.com/meetmind/meetmind/releases', '_blank'));

  pill.append(mark, copy, btn);
  return addMinimizeControl(pill);
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
  timerInterval = null;
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
          // Surface the finished state even if the user had docked the overlay
          if (collapsed) setCollapsed(false);
          else render();
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
    else if (k === 'style') node.setAttribute('style', v);
    else node.setAttribute(k, v);
  }
  if (text) node.textContent = text;
  return node;
}

function brandMark(variant = '') {
  const mark = el('div', { class: variant ? `brand-mark ${variant}` : 'brand-mark' });
  if (variant !== 'muted') {
    mark.appendChild(iconMic(12));
  }
  return mark;
}

function svgEl(attrs = {}) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  const defaults = {
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': '2.4',
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
    viewBox: '0 0 24 24',
  };
  for (const [k, v] of Object.entries({ ...defaults, ...attrs })) {
    svg.setAttribute(k, v);
  }
  return svg;
}

function path(d) {
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  p.setAttribute('d', d);
  return p;
}

function iconMic(size) {
  const svg = svgEl({ width: size, height: size });
  svg.append(
    path('M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z'),
    path('M19 10v2a7 7 0 0 1-14 0v-2'),
    path('M12 19v3'),
  );
  return svg;
}

function iconSquare(size) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('viewBox', '0 0 10 10');
  const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  rect.setAttribute('width', '10');
  rect.setAttribute('height', '10');
  rect.setAttribute('rx', '1.5');
  rect.setAttribute('fill', 'currentColor');
  svg.appendChild(rect);
  return svg;
}

function iconCheck(size) {
  const svg = svgEl({ width: size, height: size, 'stroke-width': '3' });
  svg.appendChild(path('M20 6 9 17l-5-5'));
  return svg;
}

function iconClose(size) {
  const svg = svgEl({ width: size, height: size, 'stroke-width': '2.2' });
  svg.append(path('M18 6 6 18'), path('M6 6l12 12'));
  return svg;
}

function iconExternal(size) {
  const svg = svgEl({ width: size, height: size, 'stroke-width': '2.2' });
  svg.append(
    path('M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6'),
    path('M15 3h6v6'),
    path('M10 14 21 3'),
  );
  return svg;
}

function iconApp(size) {
  const svg = svgEl({ width: size, height: size, 'stroke-width': '2.2' });
  const mk = (x, y) => {
    const r = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    r.setAttribute('x', String(x));
    r.setAttribute('y', String(y));
    r.setAttribute('width', '7');
    r.setAttribute('height', '7');
    r.setAttribute('rx', '1.5');
    return r;
  };
  svg.append(mk(3, 3), mk(14, 3), mk(3, 14), mk(14, 14));
  return svg;
}

function iconDownload(size) {
  const svg = svgEl({ width: size, height: size, 'stroke-width': '2.2' });
  svg.append(
    path('M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4'),
    path('M7 10l5 5 5-5'),
    path('M12 15V3'),
  );
  return svg;
}

function iconDock(size) {
  const svg = svgEl({ width: size, height: size, 'stroke-width': '2.2' });
  svg.append(
    path('M20 6H10a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h10'),
    path('M9 12h11'),
    path('M17 9l3 3-3 3'),
  );
  return svg;
}

render();
