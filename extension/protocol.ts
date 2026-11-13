/* eslint-disable @typescript-eslint/no-unused-vars -- a global script file: its types are used by the other extension scripts, which ESLint cannot see from here */
/**
 * Message protocols of the MeetMind extension. Types only: the extension's scripts are classic
 * (non-module) scripts, so this file must not import or export anything. Its declarations are global
 * to the project, and it compiles to an empty script that no page loads.
 *
 * Four channels, each a discriminated union on `type`:
 *
 *   service worker <-> desktop app   WebSocket JSON (electron/websocket-server.ts, electron/main.ts)
 *       ExtensionToDesktopMessage / DesktopToExtensionMessage
 *   content script / popup / bridge page -> service worker   chrome.runtime.sendMessage
 *       BackgroundRequest, answered with the matching *Response
 *   service worker -> content script   chrome.tabs.sendMessage
 *       BackgroundToContentMessage
 *   content script <-> overlay iframe   window.postMessage
 *       ContentToOverlayMessage / OverlayToContentMessage
 *
 * Everything that arrives over a channel is `unknown` until a parse function in the receiving script
 * has checked it. Optional fields are dropped, not rejected, when they have the wrong type.
 */

// ── Service worker <-> desktop app (WebSocket) ───────────────────────────────

/** Sent by the service worker. The server answers `APP_STATUS` with the current status. */
type ExtensionToDesktopMessage =
  | { type: 'START_RECORDING'; meetingUrl: string; meetingTitle: string }
  | { type: 'STOP_RECORDING' }
  | { type: 'APP_STATUS' } // the 10 s heartbeat, doubling as a status request
  | { type: 'SHOW_WINDOW' }
  | { type: 'MEETING_DETECTED'; url: string; title: string; platform: string }
  | { type: 'MEETING_ENDED' };

/** Sent by the desktop app: the status on connect and on each heartbeat, then pipeline broadcasts. */
type DesktopToExtensionMessage =
  | { type: 'APP_STATUS'; recording: boolean; sessionId?: string }
  | { type: 'RECORDING_STARTED'; sessionId?: string }
  | { type: 'RECORDING_STOPPED'; sessionId?: string }
  | { type: 'PROCESSING_PROGRESS'; stage?: string; percent?: number; sessionId?: string }
  | { type: 'PROCESSING_COMPLETE'; notionUrl?: string | null; sessionId?: string }
  | { type: 'PROCESSING_ERROR'; error?: string; sessionId?: string };

// ── Overlay state updates (service worker -> content script -> overlay) ──────

/** `UPDATE_OVERLAY` carries one of these, told apart by `state`. */
type UpdateOverlayMessage =
  | { type: 'UPDATE_OVERLAY'; state: 'RECORDING'; sessionId?: string }
  | { type: 'UPDATE_OVERLAY'; state: 'PROCESSING'; stage?: string; percent?: number }
  | { type: 'UPDATE_OVERLAY'; state: 'COMPLETE'; notionUrl?: string | null; sessionId?: string }
  | { type: 'UPDATE_OVERLAY'; state: 'ERROR'; error?: string };

// ── Content script / popup / bridge page -> service worker (chrome.runtime) ──

type BackgroundRequest =
  | { type: 'START_RECORDING'; meetingUrl: string; meetingTitle: string }
  | { type: 'STOP_RECORDING' }
  | { type: 'GET_STATUS' }
  | { type: 'OPEN_APP' }
  | { type: 'CLOSE_OPEN_APP_TAB' };

interface StartRecordingResponse { success: boolean; wsConnected: boolean }
interface SuccessResponse { success: boolean } // STOP_RECORDING, OPEN_APP, CLOSE_OPEN_APP_TAB
interface GetStatusResponse { wsConnected: boolean; activeMeetingTabId: number | null }

// ── Service worker -> content script (chrome.tabs.sendMessage) ───────────────

type BackgroundToContentMessage =
  | { type: 'INJECT_OVERLAY'; meetingUrl?: string; meetingTitle?: string; appConnected?: boolean }
  | { type: 'REMOVE_OVERLAY' }
  | UpdateOverlayMessage
  | { type: 'WS_CONNECTED' }
  | { type: 'APP_OFFLINE' }
  | { type: 'APP_STATUS'; recording: boolean };

// ── Content script <-> overlay iframe (window.postMessage) ───────────────────

type ContentToOverlayMessage =
  | { type: 'INIT'; meetingUrl: string; meetingTitle: string; appConnected: boolean }
  | { type: 'APP_CONNECTED' }
  | { type: 'APP_OFFLINE' }
  | { type: 'APP_STATUS'; recording: boolean }
  | UpdateOverlayMessage;

type OverlayToContentMessage =
  | { type: 'OVERLAY_START_RECORDING'; meetingUrl?: string; meetingTitle?: string }
  | { type: 'OVERLAY_STOP_RECORDING' }
  | { type: 'OVERLAY_OPEN_APP' }
  | { type: 'OVERLAY_RESIZE'; height?: number; width?: number; collapsed?: boolean }
  | { type: 'OVERLAY_DISMISS' };
