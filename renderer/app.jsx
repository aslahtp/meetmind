import React, { useState, useEffect, useCallback, useRef, createContext, useContext } from 'react';
import { createRoot } from 'react-dom/client';
import {
  Mic,
  X,
  Minus,
  Square,
  Sun,
  Moon,
  Monitor,
  ArrowUpCircle,
  Loader2,
  LayoutDashboard,
  CalendarDays,
  Settings as SettingsIcon,
  ScrollText,
} from 'lucide-react';
import './styles/globals.css';

import Dashboard from './components/Dashboard.jsx';
import Meetings from './components/Meetings.jsx';
import NoteViewer from './components/NoteViewer.jsx';
import Settings from './components/Settings.jsx';
import LogsViewer from './components/LogsViewer.jsx';
import RecordingBar from './components/RecordingBar.jsx';
import { IconButton, StatusDot, useConfirmDialog } from './components/ui/index.jsx';
import { STAGE_LABELS } from './lib/status.js';

// ── App Context ───────────────────────────────────────────────────────────────

export const AppContext = createContext(null);

export function useApp() {
  return useContext(AppContext);
}

// ── Toast System ──────────────────────────────────────────────────────────────

const TOAST_TONE = {
  warning: 'warning',
  info:    'ink',
  success: 'ok',
  error:   'error',
};

function Toast({ id, message, type = 'info', action, onDismiss }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const enterTimer = requestAnimationFrame(() => setVisible(true));
    const exitTimer = setTimeout(() => {
      setVisible(false);
      setTimeout(() => onDismiss(id), 200);
    }, action ? 8000 : 5000);
    return () => {
      cancelAnimationFrame(enterTimer);
      clearTimeout(exitTimer);
    };
  }, [id, onDismiss, action]);

  const dismiss = () => { setVisible(false); setTimeout(() => onDismiss(id), 200); };

  return (
    <div
      className={`floating rounded-image flex items-start gap-16 px-16 py-16 w-[360px] max-w-full transition-all duration-200 ${
        visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'
      }`}
      role={type === 'error' ? 'alert' : 'status'}
    >
      <StatusDot tone={TOAST_TONE[type] || 'ink'} className="mt-4" />
      <div className="flex-1 min-w-0">
        <p className="text-caption text-ink">{message}</p>
        {action && (
          <button
            type="button"
            className="mt-8 text-caption font-medium text-ink underline underline-offset-4"
            onClick={() => { action.onClick(); dismiss(); }}
          >
            {action.label}
          </button>
        )}
      </div>
      <button type="button" onClick={dismiss} className="text-graphite hover:text-ink" aria-label="Dismiss notification">
        <X size={16} strokeWidth={1.75} />
      </button>
    </div>
  );
}

function ToastContainer({ toasts, onDismiss }) {
  return (
    <div className="fixed bottom-24 right-24 z-[90] flex flex-col gap-8 pointer-events-none" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className="pointer-events-auto">
          <Toast {...t} onDismiss={onDismiss} />
        </div>
      ))}
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

export function hasSttApiKey(cfg) {
  const service = cfg?.sttService || 'google';
  if (service === 'assemblyai') return !!cfg?.assemblyAiApiKey?.trim();
  if (service === 'sarvam') return !!cfg?.sarvamApiKey?.trim();
  return !!cfg?.googleApiKey?.trim();
}

const THEMES = ['light', 'dark', 'system'];

function normalizeTheme(value) {
  return THEMES.includes(value) ? value : 'light';
}

function getEffectiveTheme(themeSetting) {
  if (themeSetting === 'system') {
    if (typeof window !== 'undefined' && window.matchMedia) {
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    return 'light';
  }
  return themeSetting === 'dark' ? 'dark' : 'light';
}

function applyTheme(themeSetting) {
  if (typeof document === 'undefined') return;
  const effective = getEffectiveTheme(themeSetting);
  document.documentElement.classList.toggle('dark', effective === 'dark');
  document.documentElement.classList.toggle('light', effective === 'light');
}

// ── Root App ──────────────────────────────────────────────────────────────────

function App() {
  const [view, rawSetView] = useState('dashboard');        // 'dashboard' | 'meetings' | 'session' | 'settings' | 'logs'
  const [selectedSession, setSelectedSession] = useState(null);
  const [sessionOrigin, setSessionOrigin] = useState('dashboard');
  const [sessions, setSessions] = useState([]);
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [sessionsError, setSessionsError] = useState(null);
  const [config, setConfigState] = useState(null);
  const [theme, setThemeState] = useState('light');
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSessionId, setRecordingSessionId] = useState(null);
  const [recordingStartedAt, setRecordingStartedAt] = useState(null);
  const [processing, setProcessing] = useState(null);      // { sessionId, stage, percent } | null
  const [updaterState, setUpdaterState] = useState(null);
  const [showUpdateBanner, setShowUpdateBanner] = useState(true);
  const [toasts, setToasts] = useState([]);

  const navGuardRef = useRef(null);
  const processingSessionRef = useRef(null);
  const viewRef = useRef(view);
  viewRef.current = view;

  const { confirm, element: confirmElement } = useConfirmDialog();

  const addToast = useCallback((message, type = 'info', action) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setToasts((prev) => [...prev.slice(-2), { id, message, type, action }]); // max 3 visible
  }, []);

  const dismissToast = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  // Views that hold unsaved state (Settings) register a guard; every navigation
  // goes through it so edits are never discarded silently.
  const setNavGuard = useCallback((guard) => {
    navGuardRef.current = guard;
  }, []);

  const requestNavigate = useCallback(async (nextView) => {
    if (nextView === viewRef.current) return true;
    if (navGuardRef.current) {
      const ok = await navGuardRef.current();
      if (!ok) return false;
    }
    rawSetView(nextView);
    return true;
  }, []);

  const trackProcessing = useCallback((sessionId) => {
    processingSessionRef.current = sessionId;
    // A progress event can arrive before the caller learns the session id
    // (e.g. pasted transcripts start at "generating") — keep any stage we have.
    setProcessing((prev) => ({
      sessionId,
      stage: prev?.stage || 'transcribing',
      percent: prev?.percent || 0,
    }));
  }, []);

  const keysNotSet = !hasSttApiKey(config) || !config?.geminiApiKey?.trim();

  // Request microphone access at startup so Windows adds this app to the
  // Privacy → Microphone list and allows FFmpeg (a desktop app) to capture audio.
  useEffect(() => {
    if (!navigator.mediaDevices?.getUserMedia) return;
    navigator.mediaDevices.getUserMedia({ audio: true })
      .then((stream) => { stream.getTracks().forEach((t) => t.stop()); })
      .catch(() => { /* permission denied — user will see guidance in Settings */ });
  }, []);

  // ── Renderer-based audio capture (system loopback + mic via Web Audio) ─────
  useEffect(() => {
    if (!window.meetmind?.capture) return;

    let mediaRecorder = null;
    let streams = [];
    let ctx = null;

    window.meetmind.capture.onStart(async () => {
      try {
        const sysStream = await navigator.mediaDevices.getDisplayMedia({
          audio: true,
          video: true,
        });
        sysStream.getVideoTracks().forEach((t) => t.stop());

        let micStream = null;
        try {
          micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        } catch { /* mic unavailable — system audio only */ }

        streams = [sysStream, micStream].filter(Boolean);

        ctx = new AudioContext();
        const dest = ctx.createMediaStreamDestination();
        ctx.createMediaStreamSource(sysStream).connect(dest);
        if (micStream) ctx.createMediaStreamSource(micStream).connect(dest);

        const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
          ? 'audio/webm;codecs=opus'
          : 'audio/webm';
        mediaRecorder = new MediaRecorder(dest.stream, { mimeType });
        mediaRecorder.ondataavailable = (e) => {
          if (e.data && e.data.size > 0) {
            e.data.arrayBuffer().then((buffer) => {
              if (buffer.byteLength > 0) {
                window.meetmind.capture.sendChunk(buffer);
              }
            }).catch((err) => {
              console.error('Failed to send audio chunk:', err);
            });
          }
        };
        // Emit chunks every 1 second (1000ms) for real-time disk streaming
        mediaRecorder.start(1000);

        window.meetmind.capture.sendStarted();
      } catch (err) {
        console.error('Renderer audio capture failed:', err);
        window.meetmind.capture.sendFailed(err.message);
      }
    });

    window.meetmind.capture.onStop(async () => {
      try {
        if (!mediaRecorder || mediaRecorder.state === 'inactive') {
          window.meetmind.capture.sendAudioData(new ArrayBuffer(0));
          return;
        }

        await new Promise((resolve) => {
          mediaRecorder.onstop = resolve;
          mediaRecorder.stop();
        });

        streams.forEach((s) => s.getTracks().forEach((t) => t.stop()));
        streams = [];
        if (ctx) { ctx.close().catch(() => {}); ctx = null; }

        // Short timeout to allow pending arrayBuffer microtasks to send
        await new Promise((r) => setTimeout(r, 150));

        // Send zero-length sentinel to signal "recording complete"
        window.meetmind.capture.sendAudioData(new ArrayBuffer(0));
      } catch (err) {
        console.error('Renderer capture stop failed:', err);
        window.meetmind.capture.sendAudioData(new ArrayBuffer(0));
      }
    });
  }, []);

  const refreshSessions = useCallback(async () => {
    if (!window.meetmind) return;
    try {
      const list = await window.meetmind.sessions.list();
      setSessions(list);
      setSessionsError(null);
    } catch (err) {
      console.error('Failed to load sessions:', err);
      setSessionsError(err.message || 'Failed to load meetings');
    }
  }, []);

  // Load config and sessions on mount
  useEffect(() => {
    // Never let the loading state strand the UI: if the bridge is missing or a
    // call rejects/never settles, fall through to the real view rather than
    // leaving placeholders on screen forever.
    const failsafe = setTimeout(() => setSessionsLoading(false), 5000);

    async function init() {
      if (!window.meetmind) return;
      try {
        const cfg = await window.meetmind.config.get();
        setConfigState(cfg);
        const initialTheme = normalizeTheme(cfg?.theme);
        setThemeState(initialTheme);
        applyTheme(initialTheme);
      } catch (err) {
        console.error('Config load failed:', err);
      }
      await refreshSessions();
    }

    init().finally(() => {
      clearTimeout(failsafe);
      setSessionsLoading(false);
    });

    return () => clearTimeout(failsafe);
  }, [refreshSessions]);

  // Follow OS theme changes when theme is set to 'system'
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleSystemThemeChange = () => {
      if (theme === 'system') applyTheme('system');
    };
    mediaQuery.addEventListener?.('change', handleSystemThemeChange);
    return () => mediaQuery.removeEventListener?.('change', handleSystemThemeChange);
  }, [theme]);

  // Opens a finished session — unless the current view holds unsaved state, in
  // which case the user gets a toast with an "Open" action instead.
  const showFinishedSession = useCallback(async (session) => {
    if (navGuardRef.current) {
      addToast(`Notes are ready for “${session.title || 'your meeting'}”.`, 'success', {
        label: 'Open notes',
        onClick: async () => {
          if (await requestNavigate('session')) setSelectedSession(session);
        },
      });
      return;
    }
    setSelectedSession(session);
    rawSetView('session');
  }, [addToast, requestNavigate]);

  // Register event listeners
  useEffect(() => {
    if (!window.meetmind) return;

    const unsubRecordingStarted = window.meetmind.on('recording:started', ({ sessionId }) => {
      setIsRecording(true);
      setRecordingSessionId(sessionId);
      setRecordingStartedAt((prev) => prev || Date.now());
    });

    // Stops can come from the button, the tray or the extension — the pipeline
    // always follows, so start tracking its progress here.
    const unsubRecordingStopped = window.meetmind.on('recording:stopped', ({ sessionId } = {}) => {
      setIsRecording(false);
      setRecordingStartedAt(null);
      if (sessionId) trackProcessing(sessionId);
    });

    const unsubProgress = window.meetmind.on('processing:progress', ({ stage, percent }) => {
      if (stage === 'complete') return;
      setProcessing({ sessionId: processingSessionRef.current, stage, percent });
    });

    const unsubComplete = window.meetmind.on('processing:complete', async ({ sessionId }) => {
      setProcessing(null);
      processingSessionRef.current = null;
      await refreshSessions();
      if (sessionId) {
        const session = await window.meetmind.sessions.get(sessionId);
        if (session) showFinishedSession(session);
      }
    });

    const unsubError = window.meetmind.on('processing:error', async ({ sessionId, error }) => {
      setProcessing(null);
      processingSessionRef.current = null;
      await refreshSessions();
      if (sessionId) {
        const session = await window.meetmind.sessions.get(sessionId);
        if (session) showFinishedSession({ ...session, _processingError: error });
      }
    });

    const unsubDurations = window.meetmind.on('sessions:durations-updated', async () => {
      const updated = await window.meetmind.sessions.list();
      setSessions(updated);
      setSelectedSession((prev) => {
        if (!prev?.id) return prev;
        const next = updated.find((s) => s.id === prev.id);
        return next ? { ...next, _processingError: prev._processingError } : prev;
      });
    });

    const unsubUpdater = window.meetmind.on('updater:status', (status) => {
      setUpdaterState(status);
      if (status?.status === 'downloaded') setShowUpdateBanner(true);
    });

    const unsubFallback = window.meetmind.on('gemini:fallback-used', ({ primaryModel, fallbackModel }) => {
      addToast(
        `Primary model (${primaryModel}) failed — switched to ${fallbackModel} automatically.`,
        'warning'
      );
    });

    window.meetmind.updater?.getStatus().then((status) => {
      if (status) {
        setUpdaterState(status);
        if (status.status === 'downloaded') setShowUpdateBanner(true);
      }
    });

    return () => {
      unsubRecordingStarted?.();
      unsubRecordingStopped?.();
      unsubProgress?.();
      unsubComplete?.();
      unsubError?.();
      unsubDurations?.();
      unsubUpdater?.();
      unsubFallback?.();
    };
  }, [addToast, refreshSessions, showFinishedSession, trackProcessing]);

  const openSession = useCallback(async (session) => {
    const origin = viewRef.current === 'meetings' ? 'meetings' : 'dashboard';
    if (!(await requestNavigate('session'))) return;
    setSessionOrigin(origin);
    setSelectedSession(session);
  }, [requestNavigate]);

  const openSessionById = useCallback(async (sessionId) => {
    if (!sessionId) return;
    const session = await window.meetmind.sessions.get(sessionId);
    if (session) openSession(session);
  }, [openSession]);

  const updateConfig = async (key, value) => {
    await window.meetmind.config.set(key, value);
    setConfigState((prev) => ({ ...prev, [key]: value }));
    if (key === 'theme') {
      const t = normalizeTheme(value);
      setThemeState(t);
      applyTheme(t);
    }
  };

  const updateMultipleConfig = async (updates) => {
    if (window.meetmind?.config?.setMultiple) {
      await window.meetmind.config.setMultiple(updates);
    } else {
      for (const [k, v] of Object.entries(updates)) {
        await window.meetmind.config.set(k, v);
      }
    }
    const fresh = await window.meetmind.config.get();
    setConfigState(fresh || ((prev) => ({ ...prev, ...updates })));
    if ('theme' in updates) {
      const t = normalizeTheme(updates.theme);
      setThemeState(t);
      applyTheme(t);
    }
  };

  const setTheme = async (newTheme) => {
    const validTheme = normalizeTheme(newTheme);
    setThemeState(validTheme);
    applyTheme(validTheme);
    await updateConfig('theme', validTheme);
  };

  const toggleTheme = () => {
    // Cycle: light -> dark -> system -> light
    const nextTheme = theme === 'light' ? 'dark' : theme === 'dark' ? 'system' : 'light';
    setTheme(nextTheme);
  };

  const startRecording = async () => {
    const result = await window.meetmind.recording.start();
    if (result?.success) {
      setIsRecording(true);
      setRecordingSessionId(result.sessionId);
      setRecordingStartedAt(Date.now());
    } else if (result?.error) {
      addToast(result.error, 'error');
    }
    return result;
  };

  const stopRecording = async () => {
    const result = await window.meetmind.recording.stop();
    if (result?.success) {
      setIsRecording(false);
      setRecordingStartedAt(null);
    } else if (result?.error) {
      addToast(result.error, 'error');
    }
    return result;
  };

  const ctx = {
    view,
    setView: requestNavigate,
    selectedSession, setSelectedSession,
    sessions, setSessions, refreshSessions, sessionsLoading, sessionsError,
    config, setConfigState, updateConfig, updateMultipleConfig,
    theme, setTheme, toggleTheme,
    isRecording, recordingSessionId, recordingStartedAt,
    startRecording, stopRecording,
    processing, trackProcessing,
    openSession, openSessionById,
    addToast,
    confirm,
    setNavGuard,
    keysNotSet,
  };

  return (
    <AppContext.Provider value={ctx}>
      <div className="flex flex-col h-screen overflow-hidden bg-paper text-ink">
        <TopBar />

        {isRecording && (
          <RecordingBar startedAt={recordingStartedAt} onStop={stopRecording} />
        )}

        <main className="flex-1 min-h-0 overflow-hidden">
          {view === 'dashboard' && (
            <Dashboard
              onOpenSession={openSession}
              onNavigateToSettings={() => requestNavigate('settings')}
              onNavigateToMeetings={() => requestNavigate('meetings')}
            />
          )}
          {view === 'meetings' && (
            <Meetings onOpenSession={openSession} />
          )}
          {view === 'session' && selectedSession && (
            <NoteViewer
              session={selectedSession}
              onBack={() => requestNavigate(sessionOrigin)}
              onRefresh={async () => {
                const updated = await window.meetmind.sessions.get(selectedSession.id);
                if (updated) setSelectedSession(updated);
              }}
            />
          )}
          {view === 'settings' && (
            <Settings onSave={updateMultipleConfig} />
          )}
          {view === 'logs' && (
            <LogsViewer />
          )}
        </main>
      </div>

      {updaterState?.status === 'downloaded' && showUpdateBanner && !isRecording && (
        <UpdateBanner
          version={updaterState.updateInfo?.version}
          onInstall={() => window.meetmind.updater?.install()}
          onClose={() => setShowUpdateBanner(false)}
        />
      )}

      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
      {confirmElement}
    </AppContext.Provider>
  );
}

// ── Top bar (wordmark + navigation + window controls) ────────────────────────

const NAV_ITEMS = [
  { view: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { view: 'meetings',  label: 'Meetings',  icon: CalendarDays },
  { view: 'settings',  label: 'Settings',  icon: SettingsIcon },
  { view: 'logs',      label: 'Logs',      icon: ScrollText },
];

function TopBar() {
  const {
    view, setView, isRecording, startRecording, theme, toggleTheme, config,
    processing, openSessionById,
  } = useApp();

  const items = NAV_ITEMS.filter((item) => item.view !== 'logs' || !config?.hideLogsInSidebar);
  const activeView = view === 'session' ? null : view;
  const ThemeIcon = theme === 'system' ? Monitor : theme === 'dark' ? Moon : Sun;
  const themeLabel = theme === 'system' ? 'System' : theme === 'dark' ? 'Dark' : 'Light';

  return (
    <header className="titlebar-drag flex-shrink-0 h-64 flex items-center gap-24 pl-24 border-b border-ink bg-paper select-none">
      {/* Wordmark */}
      <div className="flex items-center gap-8 flex-shrink-0">
        <span className="tile w-32 h-32 inline-flex items-center justify-center" aria-hidden="true">
          <Mic size={16} strokeWidth={2} />
        </span>
        <span className="hidden lg:inline text-body-sm font-medium text-ink">MeetMind</span>
      </div>

      {/* Navigation */}
      <nav aria-label="Main" className="titlebar-no-drag flex items-center gap-4">
        {items.map((item) => {
          const active = activeView === item.view;
          const Icon = item.icon;
          return (
            <button
              key={item.view}
              type="button"
              onClick={() => setView(item.view)}
              aria-current={active ? 'page' : undefined}
              className={`inline-flex items-center rounded-full px-16 py-8 text-caption font-medium transition-colors duration-200 ease-out border ${
                active
                  ? 'bg-ink text-paper border-ink'
                  : 'text-graphite border-transparent hover:text-ink'
              }`}
            >
              {/* Only the current page shows its icon. It stays mounted and its width, gap and
                  opacity animate, so pills resize smoothly instead of snapping when it appears. */}
              <span
                aria-hidden="true"
                className={`inline-flex items-center overflow-hidden transition-[max-width,margin-right,opacity] duration-200 ease-out ${
                  active ? 'max-w-[14px] mr-8 opacity-100' : 'max-w-[0px] mr-0 opacity-0'
                }`}
              >
                <Icon size={14} strokeWidth={1.75} className="flex-shrink-0" />
              </span>
              {item.label}
            </button>
          );
        })}
      </nav>

      <div className="flex-1" />

      {/* Status + actions */}
      <div className="titlebar-no-drag flex items-center gap-8">
        {processing && (
          <button
            type="button"
            onClick={() => openSessionById(processing.sessionId)}
            disabled={!processing.sessionId}
            className="pill hover:bg-ink/[0.06] disabled:cursor-default"
            aria-label={`${STAGE_LABELS[processing.stage] || 'Processing'}, ${Math.round(processing.percent || 0)} percent. Open meeting.`}
          >
            <Loader2 size={14} strokeWidth={2} className="spinner text-graphite" aria-hidden="true" />
            <span className="hidden lg:inline">{STAGE_LABELS[processing.stage] || 'Processing'}</span>
            <span className="tabular text-graphite">{Math.round(processing.percent || 0)}%</span>
          </button>
        )}

        <IconButton label={`Theme: ${themeLabel} (click to switch)`} onClick={toggleTheme}>
          <ThemeIcon size={16} strokeWidth={1.75} />
        </IconButton>

        {!isRecording && (
          <button type="button" onClick={startRecording} className="btn-ghost btn-sm">
            <span className="dot dot-sm dot-signal" aria-hidden="true" />
            Record
          </button>
        )}
      </div>

      <WindowControls />
    </header>
  );
}

function WindowControls() {
  const base = 'h-64 w-48 flex items-center justify-center text-graphite transition-colors duration-150';
  return (
    <div className="titlebar-no-drag flex items-stretch h-full flex-shrink-0">
      <button type="button" onClick={() => window.meetmind?.window?.minimize()} className={`${base} hover:text-ink hover:bg-ink/[0.06]`} aria-label="Minimize window">
        <Minus size={14} strokeWidth={1.75} />
      </button>
      <button type="button" onClick={() => window.meetmind?.window?.maximize()} className={`${base} hover:text-ink hover:bg-ink/[0.06]`} aria-label="Maximize or restore window">
        <Square size={12} strokeWidth={1.75} />
      </button>
      <button type="button" onClick={() => window.meetmind?.window?.close()} className={`${base} hover:text-paper hover:bg-signal`} aria-label="Close window">
        <X size={14} strokeWidth={1.75} />
      </button>
    </div>
  );
}

// ── Update Notification Banner ───────────────────────────────────────────────

function UpdateBanner({ version, onInstall, onClose }) {
  return (
    <div className="fixed bottom-24 left-24 z-[80] w-[360px] max-w-[calc(100vw-48px)] floating rounded-card p-24 fade-in" role="status">
      <div className="flex items-start justify-between gap-16">
        <div className="min-w-0">
          <p className="eyebrow">Update ready</p>
          <h3 className="text-subheading font-medium text-ink mt-8">MeetMind {version ? `v${version}` : ''} is ready</h3>
          <p className="text-caption text-graphite mt-4">Restart to finish installing the update.</p>
        </div>
        <IconButton label="Dismiss update notice" onClick={onClose}>
          <X size={16} strokeWidth={1.75} />
        </IconButton>
      </div>
      <div className="flex items-center gap-8 mt-24">
        <button type="button" onClick={onInstall} className="btn-sunshine btn-sm">
          <ArrowUpCircle size={16} strokeWidth={1.75} />
          Restart &amp; update
        </button>
        <button type="button" onClick={onClose} className="btn-quiet btn-sm">
          Later
        </button>
      </div>
    </div>
  );
}

// ── Mount ─────────────────────────────────────────────────────────────────────

const root = createRoot(document.getElementById('root'));
root.render(<App />);
