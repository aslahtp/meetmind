/**
 * MeetMind Content Script
 * Injected into Google Meet and Zoom pages.
 * Manages the overlay iframe lifecycle.
 */

let overlayFrame: HTMLIFrameElement | null = null;
const currentMeetingUrl = window.location.href;
const currentMeetingTitle = document.title;
let overlayCollapsed = false;
let overlayWidth = 160;
let overlayHeight = 52;

// Shared baseline above Meet's bottom toolbar — both expanded pill and
// minimized dock anchor to this so they share the same Y position.
const BOTTOM_OFFSET = 88;
const BAR_HEIGHT = 52;
const COLLAPSED_RADIUS = '14px 0 0 14px';

function important(prop: string, value: string) {
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

function injectOverlay(config: { meetingUrl?: string; meetingTitle?: string; appConnected?: boolean } = {}) {
  if (overlayFrame) return; // Already injected

  const frame = document.createElement('iframe');
  overlayFrame = frame;
  frame.id = 'meetmind-overlay-frame';
  frame.src = chrome.runtime.getURL('overlay/overlay.html');
  frame.allow = '';
  frame.allowFullscreen = false;
  frame.style.colorScheme = 'light';

  overlayWidth = 160;
  overlayHeight = BAR_HEIGHT;
  overlayCollapsed = false;

  (document.documentElement || document.body).appendChild(frame);
  applyOverlayBox();

  // Once loaded, send initial state
  frame.addEventListener('load', () => {
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

function sendToOverlay(message: ContentToOverlayMessage) {
  if (!overlayFrame?.contentWindow) return;
  overlayFrame.contentWindow.postMessage(message, '*');
}

function resizeOverlay(height?: number, width?: number, collapsed?: boolean) {
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

/** Checks a message from the service worker (see BackgroundToContentMessage). */
function parseBackgroundMessage(message: unknown): BackgroundToContentMessage | null {
  if (typeof message !== 'object' || message === null) return null;
  const msg = message as Record<string, unknown>;
  const text = (value: unknown) => (typeof value === 'string' ? value : undefined);

  switch (msg.type) {
    case 'INJECT_OVERLAY':
      return {
        type: 'INJECT_OVERLAY',
        meetingUrl: text(msg.meetingUrl),
        meetingTitle: text(msg.meetingTitle),
        appConnected: typeof msg.appConnected === 'boolean' ? msg.appConnected : undefined,
      };
    case 'REMOVE_OVERLAY':
    case 'WS_CONNECTED':
    case 'APP_OFFLINE':
      return { type: msg.type };
    case 'APP_STATUS':
      return { type: 'APP_STATUS', recording: !!msg.recording };
    case 'UPDATE_OVERLAY':
      return readOverlayUpdate(msg);
    default:
      return null;
  }
}

function readOverlayUpdate(msg: Record<string, unknown>): UpdateOverlayMessage | null {
  const text = (value: unknown) => (typeof value === 'string' ? value : undefined);

  switch (msg.state) {
    case 'RECORDING':
      return { type: 'UPDATE_OVERLAY', state: 'RECORDING', sessionId: text(msg.sessionId) };
    case 'PROCESSING':
      return {
        type: 'UPDATE_OVERLAY',
        state: 'PROCESSING',
        stage: text(msg.stage),
        percent: typeof msg.percent === 'number' ? msg.percent : undefined,
      };
    case 'COMPLETE':
      return {
        type: 'UPDATE_OVERLAY',
        state: 'COMPLETE',
        notionUrl: typeof msg.notionUrl === 'string' ? msg.notionUrl : null,
        sessionId: text(msg.sessionId),
      };
    case 'ERROR':
      return { type: 'UPDATE_OVERLAY', state: 'ERROR', error: text(msg.error) };
    default:
      return null;
  }
}

chrome.runtime.onMessage.addListener((raw: unknown) => {
  const message = parseBackgroundMessage(raw);
  if (!message) return;

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

/** Checks a postMessage from the overlay iframe (see OverlayToContentMessage). */
function parseOverlayMessage(data: unknown): OverlayToContentMessage | null {
  if (typeof data !== 'object' || data === null) return null;
  const msg = data as Record<string, unknown>;

  switch (msg.type) {
    case 'OVERLAY_START_RECORDING':
      return {
        type: 'OVERLAY_START_RECORDING',
        meetingUrl: typeof msg.meetingUrl === 'string' ? msg.meetingUrl : undefined,
        meetingTitle: typeof msg.meetingTitle === 'string' ? msg.meetingTitle : undefined,
      };
    case 'OVERLAY_STOP_RECORDING':
    case 'OVERLAY_OPEN_APP':
    case 'OVERLAY_DISMISS':
      return { type: msg.type };
    case 'OVERLAY_RESIZE':
      return {
        type: 'OVERLAY_RESIZE',
        height: typeof msg.height === 'number' ? msg.height : undefined,
        width: typeof msg.width === 'number' ? msg.width : undefined,
        collapsed: typeof msg.collapsed === 'boolean' ? msg.collapsed : undefined,
      };
    default:
      return null;
  }
}

function sendToBackground(request: BackgroundRequest) {
  chrome.runtime.sendMessage(request);
}

window.addEventListener('message', (event: MessageEvent<unknown>) => {
  if (!event.data || typeof event.data !== 'object') return;
  if (overlayFrame && event.source !== overlayFrame.contentWindow) return;

  const msg = parseOverlayMessage(event.data);
  if (!msg) return;

  switch (msg.type) {
    case 'OVERLAY_START_RECORDING':
      sendToBackground({
        type: 'START_RECORDING',
        meetingUrl:   currentMeetingUrl,
        meetingTitle: currentMeetingTitle,
      });
      break;

    case 'OVERLAY_STOP_RECORDING':
      sendToBackground({ type: 'STOP_RECORDING' });
      break;

    case 'OVERLAY_OPEN_APP':
      sendToBackground({ type: 'OPEN_APP' });
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
      const request: BackgroundRequest = { type: 'GET_STATUS' };
      chrome.runtime.sendMessage<BackgroundRequest, GetStatusResponse | undefined>(request, (status) => {
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
