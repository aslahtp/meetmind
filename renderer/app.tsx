import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Mic,
  X,
  Minus,
  Square,
  LayoutDashboard,
  CalendarDays,
  Settings as SettingsIcon,
  ScrollText,
} from 'lucide-react';

import Dashboard from './components/Dashboard';
import Meetings from './components/Meetings';
import NoteViewer from './components/NoteViewer';
import Settings from './components/Settings';
import ProcessingIndicator from './components/ProcessingIndicator';
import UpdateIndicator from './components/UpdateIndicator';
import { AppContext, useApp } from './lib/app-context';
import { getSetupState } from './lib/providers';
import { markScrollRestore, cancelScrollRestore } from './lib/scrollMemory';
import LogsViewer from './components/LogsViewer';
import RecordingBar from './components/RecordingBar';
import { audioMeter } from './lib/audioMeter';
import { isMac, isWindows } from './lib/os';
import { StatusDot, useConfirmDialog } from './components/ui/index';

// ── Toast System ──────────────────────────────────────────────────────────────

const TOAST_TONE = {
  warning: 'warning',
  info:    'ink',
  success: 'ok',
  error:   'error',
};

function Toast({ id, message, type = 'info', action, onDismiss }: { id?: any; message?: any; type?: any; action?: any; onDismiss?: any }) {
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
      <StatusDot tone={(TOAST_TONE as any)[type] || 'ink'} className="mt-4" />
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

function ToastContainer({ toasts, onDismiss }: { toasts?: any; onDismiss?: any }) {
  return (
    <div className="fixed bottom-24 right-24 z-[90] flex flex-col gap-8 pointer-events-none" aria-live="polite">
      {toasts.map((t: any) => (
        <div key={t.id} className="pointer-events-auto">
          <Toast {...t} onDismiss={onDismiss} />
        </div>
      ))}
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const THEMES = ['light', 'dark', 'system'];

function normalizeTheme(value: any) {
  return THEMES.includes(value) ? value : 'light';
}

function getEffectiveTheme(themeSetting: any) {
  if (themeSetting === 'system') {
    if (typeof window !== 'undefined' && window.matchMedia) {
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    return 'light';
  }
  return themeSetting === 'dark' ? 'dark' : 'light';
}

function applyTheme(themeSetting: any) {
  if (typeof document === 'undefined') return;
  const effective = getEffectiveTheme(themeSetting);
  document.documentElement.classList.toggle('dark', effective === 'dark');
  document.documentElement.classList.toggle('light', effective === 'light');
}

// ── Root App ──────────────────────────────────────────────────────────────────

export default function App() {
  const [view, rawSetView] = useState('dashboard');        // 'dashboard' | 'meetings' | 'session' | 'settings' | 'logs'
  const [selectedSession, setSelectedSession] = useState<any>(null);
  const [sessionOrigin, setSessionOrigin] = useState('dashboard');
  const [sessions, setSessions] = useState<any[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [sessionsError, setSessionsError] = useState<any>(null);
  const [config, setConfigState] = useState<any>(null);
  const [providers, setProviders] = useState<any>(null);      // STT/LLM provider descriptors from main
  const [theme, setThemeState] = useState('light');
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSessionId, setRecordingSessionId] = useState<any>(null);
  const [recordingStartedAt, setRecordingStartedAt] = useState<any>(null);
  const [processing, setProcessing] = useState<any>(null);      // { sessionId, stage, percent } | null
  const [notesPreview, setNotesPreview] = useState<any>(null);  // { sessionId, attempt, provider, model, notes } | null
  const [updaterState, setUpdaterState] = useState<any>(null);
  const [toasts, setToasts] = useState<any[]>([]);

  const navGuardRef = useRef<any>(null);
  const processingSessionRef = useRef<any>(null);
  const viewRef = useRef(view);
  viewRef.current = view;

  const { confirm, element: confirmElement } = useConfirmDialog();

  const addToast = useCallback((message: any, type = 'info', action?: any) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setToasts((prev) => [...prev.slice(-2), { id, message, type, action }]); // max 3 visible
  }, []);

  const dismissToast = useCallback((id: any) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  // Views that hold unsaved state (Settings) register a guard; every navigation
  // goes through it so edits are never discarded silently.
  const setNavGuard = useCallback((guard: any) => {
    navGuardRef.current = guard;
  }, []);

  const requestNavigate = useCallback(async (nextView: any) => {
    if (nextView === viewRef.current) return true;
    if (navGuardRef.current) {
      const ok = await navGuardRef.current();
      if (!ok) return false;
    }
    rawSetView(nextView);
    return true;
  }, []);

  const trackProcessing = useCallback((sessionId: any) => {
    processingSessionRef.current = sessionId;
    setNotesPreview((prev: any) => (prev?.sessionId === sessionId ? prev : null));
    // A progress event can arrive before the caller learns the session id
    // (e.g. pasted transcripts start at "generating") — keep any stage we have.
    setProcessing((prev: any) => ({
      sessionId,
      stage: prev?.stage || 'transcribing',
      percent: prev?.percent || 0,
    }));
  }, []);

  const setup = getSetupState(providers, config);
  const keysNotSet = setup.ready && (!setup.sttDone || !setup.llmDone);

  // Request microphone access at startup so Windows adds this app to the
  // Privacy → Microphone list and allows FFmpeg (a desktop app) to capture audio.
  // Windows only: on macOS this would raise the permission prompt at every launch.
  useEffect(() => {
    if (!isWindows || !navigator.mediaDevices?.getUserMedia) return;
    navigator.mediaDevices.getUserMedia({ audio: true })
      .then((stream) => { stream.getTracks().forEach((t) => t.stop()); })
      .catch(() => { /* permission denied — user will see guidance in Settings */ });
  }, []);

  // ── Renderer-based audio capture (system loopback + mic via Web Audio) ─────
  // The AnalyserNodes tap each channel independently and a rAF loop pushes RMS
  // levels into `audioLevels` state for the RecordingBar's live meters.
  useEffect(() => {
    if (!window.meetmind?.capture) return;

    let mediaRecorder: any = null;
    let streams: any = [];
    let ctx: any = null;
    let meterRafId: any = null;
    let sysAnalyser: any = null;
    let micAnalyser: any = null;

    // ── Level-metering loop ──────────────────────────────────────────────────
    function startMeterLoop() {
      const sysData: any = sysAnalyser ? new Float32Array(sysAnalyser.fftSize) : null;
      const micData: any = micAnalyser ? new Float32Array(micAnalyser.fftSize) : null;

      function rms(buf: any) {
        let sum = 0;
        for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
        return Math.sqrt(sum / buf.length);
      }

      // Throttle to ~30 fps to avoid hammering React state.
      let last = 0;
      function tick(ts: any) {
        meterRafId = requestAnimationFrame(tick);
        if (ts - last < 33) return;
        last = ts;

        let sysLevel = 0;
        let micLevel = 0;
        if (sysAnalyser && sysData) {
          sysAnalyser.getFloatTimeDomainData(sysData);
          sysLevel = Math.min(1, rms(sysData) * 4); // ×4 gain for visual clarity
        }
        if (micAnalyser && micData) {
          micAnalyser.getFloatTimeDomainData(micData);
          micLevel = Math.min(1, rms(micData) * 4);
        }
        audioMeter.emit({ mic: micLevel, system: sysLevel });
      }
      meterRafId = requestAnimationFrame(tick);
    }

    function stopMeterLoop() {
      if (meterRafId != null) {
        cancelAnimationFrame(meterRafId);
        meterRafId = null;
      }
      sysAnalyser = null;
      micAnalyser = null;
      audioMeter.reset();
    }

    // System audio via Electron loopback. getDisplayMedia must ask for video too; that track is
    // stopped at once. Returns null when the OS gives no system audio (permission denied, or no
    // audio track). When main can capture it with FFmpeg instead (`requireSystemAudio`: Windows
    // WASAPI, Linux PulseAudio) we fail so it falls back; otherwise the caller records the mic alone.
    async function openSystemStream(requireSystemAudio: any) {
      try {
        const stream = await navigator.mediaDevices.getDisplayMedia({ audio: true, video: true });
        stream.getVideoTracks().forEach((t) => t.stop());
        if (stream.getAudioTracks().length > 0) return stream;
        stream.getTracks().forEach((t) => t.stop());
        if (requireSystemAudio) throw new Error('System audio capture returned no audio track');
      } catch (err: any) {
        if (requireSystemAudio) throw err;
        console.warn('System audio unavailable, recording microphone only:', err);
      }
      return null;
    }

    window.meetmind.capture.onStart(async ({ requireSystemAudio = isWindows } = {}) => {
      try {
        const sysStream = await openSystemStream(requireSystemAudio);

        let micStream = null;
        try {
          micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        } catch { /* mic unavailable — system audio only */ }

        if (!sysStream && !micStream) throw new Error('No audio source available (microphone access denied?)');

        streams = [sysStream, micStream].filter(Boolean);

        ctx = new AudioContext();
        const dest = ctx.createMediaStreamDestination();

        // System audio — source → analyser → dest
        if (sysStream) {
          const sysSource = ctx.createMediaStreamSource(sysStream);
          sysAnalyser = ctx.createAnalyser();
          sysAnalyser.fftSize = 256;
          sysSource.connect(sysAnalyser);
          sysSource.connect(dest);
        }

        // Microphone — source → analyser → dest
        if (micStream) {
          const micSource = ctx.createMediaStreamSource(micStream);
          micAnalyser = ctx.createAnalyser();
          micAnalyser.fftSize = 256;
          micSource.connect(micAnalyser);
          micSource.connect(dest);
        }

        startMeterLoop();

        const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
          ? 'audio/webm;codecs=opus'
          : 'audio/webm';
        mediaRecorder = new MediaRecorder(dest.stream, { mimeType });
        mediaRecorder.ondataavailable = (e: any) => {
          if (e.data && e.data.size > 0) {
            e.data.arrayBuffer().then((buffer: any) => {
              if (buffer.byteLength > 0) {
                window.meetmind.capture.sendChunk(buffer);
              }
            }).catch((err: any) => {
              console.error('Failed to send audio chunk:', err);
            });
          }
        };
        // Emit chunks every 1 second (1000ms) for real-time disk streaming
        mediaRecorder.start(1000);

        window.meetmind.capture.sendStarted({ systemAudio: !!sysStream, mic: !!micStream });
        if (!sysStream) {
          addToast(isMac
            ? 'Recording your microphone only: system audio is unavailable. Check Screen & System Audio Recording permission.'
            : 'Recording your microphone only: system audio is unavailable. Check that PulseAudio or PipeWire is running.', 'warning');
        }
      } catch (err: any) {
        console.error('Renderer audio capture failed:', err);
        stopMeterLoop();
        window.meetmind.capture.sendFailed(err.message);
      }
    });

    window.meetmind.capture.onStop(async () => {
      stopMeterLoop();
      try {
        if (!mediaRecorder || mediaRecorder.state === 'inactive') {
          window.meetmind.capture.sendAudioData(new ArrayBuffer(0));
          return;
        }

        await new Promise((resolve) => {
          mediaRecorder.onstop = resolve;
          mediaRecorder.stop();
        });

        streams.forEach((s: any) => s.getTracks().forEach((t: any) => t.stop()));
        streams = [];
        if (ctx) { ctx.close().catch(() => {}); ctx = null; }

        // Short timeout to allow pending arrayBuffer microtasks to send
        await new Promise((r) => setTimeout(r, 150));

        // Send zero-length sentinel to signal "recording complete"
        window.meetmind.capture.sendAudioData(new ArrayBuffer(0));
      } catch (err: any) {
        console.error('Renderer capture stop failed:', err);
        window.meetmind.capture.sendAudioData(new ArrayBuffer(0));
      }
    });
  }, [addToast]); // addToast is stable, so the listeners are registered once

  // The database revision the current `sessions` list was read at (see sessions:revision).
  const sessionsRevisionRef = useRef<any>(null);
  // Refreshes can overlap (sessions:changed arrives at every write); only the latest one applies,
  // so a slow, older read never overwrites a newer list.
  const refreshSeqRef = useRef(0);

  // Re-reads every session, with full transcripts (several MB for a few hundred meetings), and
  // the open meeting with it. With { ifChanged: true }, as sessions:changed and the Dashboard and
  // Meetings pages use, it first asks main whether anything was written since the last read and
  // stops there if not, so switching tabs doesn't copy and re-render the whole list for nothing.
  const refreshSessions = useCallback(async ({ ifChanged = false } = {}) => {
    if (!window.meetmind) return;
    const seq = ++refreshSeqRef.current;
    try {
      const revision = await window.meetmind.sessions.revision?.();
      if (ifChanged && revision != null && revision === sessionsRevisionRef.current) return;
      const list = await window.meetmind.sessions.list();
      if (seq !== refreshSeqRef.current) return;
      sessionsRevisionRef.current = revision ?? null;
      setSessions(list);
      setSessionsError(null);
      setSelectedSession((prev: any) => {
        if (!prev?.id) return prev;
        const next = list.find((s) => s.id === prev.id);
        if (!next) return prev;
        // The failure message from processing:error stays only while the meeting is still failed.
        return next.status === 'error' && prev._processingError
          ? { ...next, _processingError: prev._processingError }
          : next;
      });
    } catch (err: any) {
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
      window.meetmind.providers?.list?.().then(setProviders).catch((err) => {
        console.error('Provider list load failed:', err);
      });
      try {
        const cfg = await window.meetmind.config.get();
        setConfigState(cfg);
        const initialTheme = normalizeTheme(cfg?.theme);
        setThemeState(initialTheme);
        applyTheme(initialTheme);
      } catch (err: any) {
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

  // Safety net for sessions:changed: when the window is shown or focused again (e.g. from the tray),
  // catch up on anything written meanwhile. Cheap when nothing changed (one revision check).
  useEffect(() => {
    const catchUp = () => {
      if (document.visibilityState === 'visible') refreshSessions({ ifChanged: true });
    };
    document.addEventListener('visibilitychange', catchUp);
    window.addEventListener('focus', catchUp);
    return () => {
      document.removeEventListener('visibilitychange', catchUp);
      window.removeEventListener('focus', catchUp);
    };
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
  const showFinishedSession = useCallback(async (session: any) => {
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
      setRecordingStartedAt((prev: any) => prev || Date.now());
    });

    // Stops can come from the button, the tray, the meeting overlay or the extension — the pipeline
    // always follows, so start tracking its progress here.
    const unsubRecordingStopped = window.meetmind.on('recording:stopped', ({ sessionId } = {} as any) => {
      setIsRecording(false);
      setRecordingStartedAt(null);
      if (sessionId) trackProcessing(sessionId);
    });

    const unsubProgress = window.meetmind.on('processing:progress', ({ stage, percent }) => {
      if (stage === 'complete') return;
      setProcessing({ sessionId: processingSessionRef.current, stage, percent });
    });

    // Notes streamed so far while the LLM writes them (see generateNotes' onPreview).
    const unsubPreview = window.meetmind.on('notes:preview', (preview) => {
      setNotesPreview(preview);
    });
    // Cleared only once the finished session is loaded, so old notes don't flash back in between.
    const clearPreview = (sessionId: any) => {
      setNotesPreview((prev: any) => (!sessionId || prev?.sessionId === sessionId ? null : prev));
    };

    const unsubComplete = window.meetmind.on('processing:complete', async ({ sessionId }) => {
      setProcessing(null);
      processingSessionRef.current = null;
      await refreshSessions();
      if (sessionId) {
        const session = await window.meetmind.sessions.get(sessionId);
        if (session) showFinishedSession(session);
      }
      clearPreview(sessionId);
    });

    const unsubError = window.meetmind.on('processing:error', async ({ sessionId, error }) => {
      setProcessing(null);
      processingSessionRef.current = null;
      await refreshSessions();
      if (sessionId) {
        const session = await window.meetmind.sessions.get(sessionId);
        if (session) showFinishedSession({ ...session, _processingError: error });
      }
      clearPreview(sessionId);
    });

    // Pipeline was cancelled because the session was deleted mid-flight.
    const unsubCancelled = window.meetmind.on('processing:cancelled', ({ sessionId } = {} as any) => {
      setProcessing(null);
      clearPreview(sessionId);
      processingSessionRef.current = null;
      refreshSessions();
    });

    // Main sends this after every database write (a recording starting or stopping, each pipeline
    // stage, imports, renames, deletions, the startup recovery and cleanup), so the cards and the
    // open meeting always show the saved status.
    const unsubSessionsChanged = window.meetmind.on('sessions:changed', () => {
      refreshSessions({ ifChanged: true });
    });

    const unsubUpdater = window.meetmind.on('updater:status', (status) => {
      setUpdaterState(status);
    });

    const unsubFallback = window.meetmind.on('llm:fallback-used', ({ primaryModel, fallbackModel }) => {
      addToast(
        `Primary model (${primaryModel}) failed — switched to ${fallbackModel} automatically.`,
        'warning'
      );
    });

    window.meetmind.updater?.getStatus().then((status) => {
      if (status) setUpdaterState(status);
    });

    return () => {
      unsubRecordingStarted?.();
      unsubRecordingStopped?.();
      unsubProgress?.();
      unsubPreview?.();
      unsubComplete?.();
      unsubError?.();
      unsubCancelled?.();
      unsubSessionsChanged?.();
      unsubUpdater?.();
      unsubFallback?.();
    };
  }, [addToast, refreshSessions, showFinishedSession, trackProcessing]);

  const openSession = useCallback(async (session: any) => {
    const origin = viewRef.current === 'meetings' ? 'meetings' : 'dashboard';
    // requestNavigate skips the guard for the current view, so switching from one
    // meeting to another (e.g. from the processing pill) checks for unsaved edits here.
    if (viewRef.current === 'session' && navGuardRef.current && !(await navGuardRef.current())) return;
    if (!(await requestNavigate('session'))) return;
    setSessionOrigin(origin);
    setSelectedSession(session);
  }, [requestNavigate]);

  const openSessionById = useCallback(async (sessionId: any) => {
    if (!sessionId) return;
    const session = await window.meetmind.sessions.get(sessionId);
    if (session) openSession(session);
  }, [openSession]);

  // "Open notes" on the desktop meeting overlay.
  useEffect(() => {
    if (!window.meetmind) return undefined;
    return window.meetmind.on('app:open-session', ({ sessionId } = {} as any) => openSessionById(sessionId));
  }, [openSessionById]);

  // macOS app menu (e.g. Settings… ⌘,).
  useEffect(() => {
    if (!window.meetmind) return undefined;
    return window.meetmind.on('app:navigate', (nextView) => {
      if (['dashboard', 'meetings', 'settings', 'logs'].includes(nextView)) requestNavigate(nextView);
    });
  }, [requestNavigate]);

  const updateConfig = async (key: any, value: any) => {
    await window.meetmind.config.set(key, value);
    setConfigState((prev: any) => ({ ...prev, [key]: value }));
    if (key === 'theme') {
      const t = normalizeTheme(value);
      setThemeState(t);
      applyTheme(t);
    }
  };

  const updateMultipleConfig = async (updates: any) => {
    if (window.meetmind?.config?.setMultiple) {
      await window.meetmind.config.setMultiple(updates);
    } else {
      for (const [k, v] of Object.entries(updates)) {
        await window.meetmind.config.set(k as any, v);
      }
    }
    const fresh = await window.meetmind.config.get();
    setConfigState(fresh || ((prev: any) => ({ ...prev, ...updates })));
    if ('theme' in updates) {
      const t = normalizeTheme(updates.theme);
      setThemeState(t);
      applyTheme(t);
    }
  };

  const setTheme = async (newTheme: any) => {
    const validTheme = normalizeTheme(newTheme);
    setThemeState(validTheme);
    applyTheme(validTheme);
    await updateConfig('theme', validTheme);
  };

  // `meeting` ({ meetingUrl, meetingTitle }) names the session after a calendar event; buttons
  // that call this as a click handler pass an event object, which is ignored.
  const startRecording = async (meeting: any) => {
    const fromCalendar = typeof meeting?.meetingTitle === 'string';
    const result = fromCalendar
      ? await window.meetmind.recording.start(undefined, meeting.meetingUrl || undefined, meeting.meetingTitle)
      : await window.meetmind.recording.start();
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
    providers, setup,
    theme, setTheme,
    isRecording, recordingSessionId, recordingStartedAt,
    startRecording, stopRecording,
    processing, trackProcessing, notesPreview,
    updaterState,
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
              key={selectedSession.id}
              session={selectedSession}
              onBack={async () => {
                // Return to the list where it was scrolled, not the top.
                markScrollRestore(sessionOrigin);
                if (!(await requestNavigate(sessionOrigin))) cancelScrollRestore(sessionOrigin);
              }}
              onRefresh={async () => {
                const updated = await window.meetmind.sessions.get(selectedSession.id);
                if (updated) setSelectedSession(updated);
                refreshSessions();
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
    view, setView, isRecording, startRecording, config, keysNotSet,
    processing, openSessionById, updaterState,
  } = useApp();

  const items = NAV_ITEMS.filter((item) => item.view !== 'logs' || !config?.hideLogsInSidebar);
  const activeView = view === 'session' ? null : view;
  // The processing pill sizes itself to the free space this spacer represents.
  const spacerRef = useRef<any>(null);

  return (
    // macOS keeps its native traffic lights (inset by main.js at x 24); the bar starts after them
    // and has no custom window buttons on the right.
    <header className={`titlebar-drag flex-shrink-0 h-64 flex items-center gap-16 lg:gap-24 ${isMac ? 'pl-[96px] pr-24' : 'pl-24'} border-b border-ink bg-paper select-none`}>
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
              className={`inline-flex items-center rounded-full px-8 lg:px-16 py-8 text-caption font-medium transition-colors duration-200 ease-out border ${
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

      <div ref={spacerRef} className="flex-1" />

      {/* Status + actions: the app-update pill and the live processing pill (both animate in and
          out; the update one opens a panel), then Record, the app's
          primary action (yellow; ink while the Dashboard's setup card holds the yellow instead).
          Spacing is per-item margins, not `gap`, so the collapsed pill slot leaves no extra space. */}
      <div className="titlebar-no-drag flex items-center">
        <UpdateIndicator state={updaterState} />
        <ProcessingIndicator processing={processing} onOpen={openSessionById} spacerRef={spacerRef} />

        {!isRecording && (
          <button type="button" onClick={startRecording} className={`${keysNotSet ? 'btn-ink' : 'btn-sunshine'} btn-sm ml-8`}>
            <span className="dot dot-sm dot-signal" aria-hidden="true" />
            Record
          </button>
        )}
      </div>

      {!isMac && <WindowControls />}
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
