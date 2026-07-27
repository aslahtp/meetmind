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
const PILL_ICON_SIZE = 16;
const NOTION_ICON_URL = typeof chrome !== 'undefined' && chrome.runtime?.getURL
  ? chrome.runtime.getURL('icons/icons8-notion-96.png')
  : '../icons/icons8-notion-96.png';

const MATERIAL_ICON_PATHS = {
  'collapse_content.svg': 'M440-440v240h-80v-160H200v-80h240Zm160-320v160h160v80H520v-240h80Z',
  'open_in_app.svg': 'M200-120q-33 0-56.5-23.5T120-200v-560q0-33 23.5-56.5T200-840h560q33 0 56.5 23.5T840-760v560q0 33-23.5 56.5T760-120H600v-80h160v-480H200v480h160v80H200Zm240 0v-246l-64 64-56-58 160-160 160 160-56 58-64-64v246h-80Z',
};

// ── Render ────────────────────────────────────────────────────────────────────

function render() {
  root.innerHTML = '';
  root.classList.toggle('docked', collapsed);
  const node = collapsed ? buildDockUI() : buildUI();
  if (node) root.appendChild(node);
  requestResize();
}

function requestResize() {
  // Fixed bar height keeps expanded + minimized on the same vertical band.
  // Expanded pill uses one fixed width across all states.
  if (collapsed) {
    window.parent.postMessage({
      type: 'OVERLAY_RESIZE',
      height: 52,
      width: 40,
      collapsed: true,
    }, '*');
    return;
  }

  window.parent.postMessage({
    type: 'OVERLAY_RESIZE',
    height: 52,
    width: 160,
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

  const mark = brandMark('', 'dock');

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

  const hideBtn = el('button', {
    class: 'icon-btn',
    type: 'button',
    title: 'Hide to edge',
    'aria-label': 'Hide overlay to right edge',
  });
  hideBtn.appendChild(iconAsset('collapse_content.svg'));
  hideBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    setCollapsed(true);
  });
  pill.appendChild(hideBtn);

  if (dismiss) {
    const closeBtn = el('button', {
      class: 'icon-btn',
      type: 'button',
      title: 'Dismiss',
      'aria-label': 'Dismiss overlay',
    });
    closeBtn.appendChild(iconClose());
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      clearTimeout(dismissTimer);
      window.parent.postMessage({ type: 'OVERLAY_DISMISS' }, '*');
    });
    pill.appendChild(closeBtn);
  }

  return pill;
}

function pillLabel(text, extraClass = '') {
  return el('span', {
    class: extraClass ? `pill-label ${extraClass}` : 'pill-label',
    title: text,
  }, text);
}

// ── IDLE ──────────────────────────────────────────────────────────────────────

function buildIdleUI() {
  const pill = el('div', { class: 'pill compact' });

  const mark = brandMark();

  const btn = el('button', {
    class: 'btn btn-start btn-fill',
    type: 'button',
    title: 'Start recording',
    'aria-label': 'Start recording',
  });
  btn.append(iconMic(13), document.createTextNode('Record'));
  btn.addEventListener('click', startRecording);

  pill.append(mark, btn);
  return addMinimizeControl(pill);
}

// ── RECORDING ─────────────────────────────────────────────────────────────────

function buildRecordingUI() {
  const pill = el('div', { class: 'pill compact recording-active' });

  const dot = el('span', { class: 'dot recording', title: 'Recording' });
  const time = el('span', {
    class: 'pill-label timer-label',
    id: 'timer-display',
    title: 'Recording time',
  }, formatTime(timerSeconds));

  const btn = el('button', {
    class: 'icon-btn icon-btn-stop',
    type: 'button',
    title: 'Stop recording',
    'aria-label': 'Stop recording',
  });
  btn.appendChild(iconSquare());
  btn.addEventListener('click', stopRecording);

  pill.append(dot, time, btn);
  return addMinimizeControl(pill);
}

// ── PROCESSING ────────────────────────────────────────────────────────────────

function buildProcessingUI() {
  const pill = el('div', { class: 'pill compact' });

  const spinner = el('div', {
    class: 'spinner',
    title: stageLabel(processingStage),
    'aria-hidden': 'true',
  });
  const label = pillLabel(stageShort(processingStage));
  const pct = el('span', {
    class: 'pct-text',
    title: `${Math.round(processingPercent)}%`,
  }, `${Math.round(processingPercent)}%`);

  pill.append(spinner, label, pct);
  return addMinimizeControl(pill);
}

function stageLabel(stage) {
  const labels = {
    transcribing: 'Transcribing audio…',
    generating:   'Generating notes…',
    uploading:    'Uploading to Notion…',
    complete:     'Almost done…',
  };
  return labels[stage] || 'Processing…';
}

function stageShort(stage) {
  const labels = {
    transcribing: 'Transcribe',
    generating:   'Writing',
    uploading:    'Upload',
    complete:     'Finishing',
  };
  return labels[stage] || 'Working';
}

// ── COMPLETE ──────────────────────────────────────────────────────────────────

function buildCompleteUI() {
  const pill = el('div', { class: 'pill compact' });

  const checkIcon = el('div', { class: 'check-icon', title: 'Notes ready' });
  checkIcon.appendChild(iconCheck(11));
  pill.append(checkIcon, pillLabel('Done'));

  if (notionUrl) {
    const notionBtn = el('button', {
      class: 'icon-btn',
      type: 'button',
      title: 'Open in Notion',
      'aria-label': 'Open in Notion',
    });
    notionBtn.appendChild(iconNotion());
    notionBtn.addEventListener('click', () => window.open(notionUrl, '_blank'));
    pill.appendChild(notionBtn);
  }

  const appBtn = el('button', {
    class: 'icon-btn',
    type: 'button',
    title: 'View in App',
    'aria-label': 'View in App',
  });
  appBtn.appendChild(iconAsset('open_in_app.svg'));
  appBtn.addEventListener('click', () => window.parent.postMessage({ type: 'OVERLAY_OPEN_APP' }, '*'));
  pill.appendChild(appBtn);

  addMinimizeControl(pill);
  startDismissCountdown();
  return pill;
}

function startDismissCountdown() {
  clearTimeout(dismissTimer);
  let remaining = dismissSeconds;
  const tick = () => {
    remaining--;
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
  const pill = el('div', { class: 'pill compact' });

  const mark = brandMark('muted offline');
  mark.setAttribute('title', 'MeetMind — app offline');

  const label = pillLabel('Offline', 'offline-label');

  const btn = el('button', {
    class: 'icon-btn',
    type: 'button',
    title: 'Open MeetMind app',
    'aria-label': 'Open MeetMind app',
  });
  btn.appendChild(iconAsset('open_in_app.svg'));
  btn.addEventListener('click', () => window.parent.postMessage({ type: 'OVERLAY_OPEN_APP' }, '*'));

  pill.append(mark, label, btn);
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

function brandMark(variant = '', size = 'pill') {
  const classes = ['brand-mark'];
  if (variant) classes.push(variant);
  if (size === 'dock') classes.push('dock-size');
  const mark = el('div', { class: classes.join(' ') });
  mark.appendChild(iconMic(size === 'dock' ? 11 : 12));
  return mark;
}

function iconAsset(filename, size = PILL_ICON_SIZE) {
  const pathD = MATERIAL_ICON_PATHS[filename];
  if (!pathD) throw new Error(`Unknown icon asset: ${filename}`);
  return iconMaterial(pathD, size);
}

function iconMaterial(pathD, size = PILL_ICON_SIZE) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('viewBox', '0 -960 960 960');
  svg.setAttribute('fill', 'currentColor');
  svg.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  p.setAttribute('d', pathD);
  svg.appendChild(p);
  return svg;
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

function iconMic(size = PILL_ICON_SIZE) {
  const svg = svgEl({ width: size, height: size });
  svg.append(
    path('M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z'),
    path('M19 10v2a7 7 0 0 1-14 0v-2'),
    path('M12 19v3'),
  );
  return svg;
}

function iconSquare(size = 10) {
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

function iconCheck(size = 11) {
  const svg = svgEl({ width: size, height: size, 'stroke-width': '3' });
  svg.appendChild(path('M20 6 9 17l-5-5'));
  return svg;
}

function iconClose(size = PILL_ICON_SIZE) {
  const svg = svgEl({ width: size, height: size, 'stroke-width': '2.2' });
  svg.append(path('M18 6 6 18'), path('M6 6l12 12'));
  return svg;
}

function iconNotion(size = PILL_ICON_SIZE) {
  const img = document.createElement('img');
  img.src = NOTION_ICON_URL;
  img.width = size;
  img.height = size;
  img.alt = '';
  img.className = 'notion-icon';
  img.setAttribute('aria-hidden', 'true');
  img.draggable = false;
  return img;
}

function iconExternal(size = PILL_ICON_SIZE) {
  const svg = svgEl({ width: size, height: size, 'stroke-width': '2.2' });
  svg.append(
    path('M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6'),
    path('M15 3h6v6'),
    path('M10 14 21 3'),
  );
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

render();
