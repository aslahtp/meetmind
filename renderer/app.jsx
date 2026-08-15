import React, { useState, useEffect, createContext, useContext } from 'react';
import { createRoot } from 'react-dom/client';
import {
  Mic,
  LayoutGrid,
  Settings as SettingsIcon,
  Terminal,
  X,
  Minus,
  Square,
  ArrowRight,
  KeyRound,
  Sparkles,
  ArrowUpCircle,
  Sun,
  Moon,
  Monitor,
} from 'lucide-react';
import './styles/globals.css';

import Dashboard from './components/Dashboard.jsx';
import NoteViewer from './components/NoteViewer.jsx';
import Settings from './components/Settings.jsx';
import LogsViewer from './components/LogsViewer.jsx';
import RecordingBar from './components/RecordingBar.jsx';

// ── App Context ───────────────────────────────────────────────────────────────

export const AppContext = createContext(null);

export function useApp() {
  return useContext(AppContext);
}

// ── Root App ──────────────────────────────────────────────────────────────────

function hasSttApiKey(cfg) {
  const service = cfg?.sttService || 'google';
  if (service === 'assemblyai') return !!cfg?.assemblyAiApiKey?.trim();
  if (service === 'sarvam') return !!cfg?.sarvamApiKey?.trim();
  return !!cfg?.googleApiKey?.trim();
}

function getEffectiveTheme(themeSetting) {
  if (themeSetting === 'system') {
    if (typeof window !== 'undefined' && window.matchMedia) {
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    return 'dark';
  }
  return themeSetting === 'light' ? 'light' : 'dark';
}

function applyTheme(themeSetting) {
  if (typeof document === 'undefined') return;
  const effective = getEffectiveTheme(themeSetting);
  if (effective === 'light') {
    document.documentElement.classList.remove('dark');
    document.documentElement.classList.add('light');
  } else {
    document.documentElement.classList.remove('light');
    document.documentElement.classList.add('dark');
  }
}

function App() {
  const [view, setView] = useState('dashboard');           // 'dashboard' | 'session' | 'settings' | 'logs'
  const [selectedSession, setSelectedSession] = useState(null);
  const [sessions, setSessions] = useState([]);
  const [config, setConfigState] = useState(null);
  const [theme, setThemeState] = useState('dark');         // 'dark' | 'light' | 'system'
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSessionId, setRecordingSessionId] = useState(null);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [updaterState, setUpdaterState] = useState(null);
  const [showUpdateBanner, setShowUpdateBanner] = useState(true);

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

  // Load config and sessions on mount
  useEffect(() => {
    async function init() {
      if (!window.meetmind) return;
      const cfg = await window.meetmind.config.get();
      setConfigState(cfg);
      const initialTheme = ['light', 'dark', 'system'].includes(cfg?.theme) ? cfg.theme : 'dark';
      setThemeState(initialTheme);
      applyTheme(initialTheme);

      if (!hasSttApiKey(cfg) || !cfg?.geminiApiKey?.trim()) setShowOnboarding(true);

      const list = await window.meetmind.sessions.list();
      setSessions(list);
    }
    init();
  }, []);

  // Listen for system theme changes when theme is set to 'system'
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleSystemThemeChange = () => {
      if (theme === 'system') {
        applyTheme('system');
      }
    };
    if (mediaQuery.addEventListener) {
      mediaQuery.addEventListener('change', handleSystemThemeChange);
      return () => mediaQuery.removeEventListener('change', handleSystemThemeChange);
    } else if (mediaQuery.addListener) {
      mediaQuery.addListener(handleSystemThemeChange);
      return () => mediaQuery.removeListener(handleSystemThemeChange);
    }
  }, [theme]);

  // Register event listeners
  useEffect(() => {
    if (!window.meetmind) return;

    const unsubRecordingStarted = window.meetmind.on('recording:started', ({ sessionId }) => {
      setIsRecording(true);
      setRecordingSessionId(sessionId);
    });

    const unsubRecordingStopped = window.meetmind.on('recording:stopped', () => {
      setIsRecording(false);
    });

    const unsubComplete = window.meetmind.on('processing:complete', async ({ sessionId }) => {
      const updated = await window.meetmind.sessions.list();
      setSessions(updated);
      if (sessionId) {
        const session = await window.meetmind.sessions.get(sessionId);
        if (session) {
          setSelectedSession(session);
          setView('session');
        }
      }
    });

    const unsubError = window.meetmind.on('processing:error', async ({ sessionId, error }) => {
      const updated = await window.meetmind.sessions.list();
      setSessions(updated);
      if (sessionId) {
        const session = await window.meetmind.sessions.get(sessionId);
        if (session) {
          setSelectedSession({ ...session, _processingError: error });
          setView('session');
        }
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
      if (status?.status === 'downloaded') {
        setShowUpdateBanner(true);
      }
    });

    // Check initial updater status
    window.meetmind.updater?.getStatus().then((status) => {
      if (status) {
        setUpdaterState(status);
        if (status.status === 'downloaded') {
          setShowUpdateBanner(true);
        }
      }
    });

    return () => {
      unsubRecordingStarted?.();
      unsubRecordingStopped?.();
      unsubComplete?.();
      unsubError?.();
      unsubDurations?.();
      unsubUpdater?.();
    };
  }, []);

  const refreshSessions = async () => {
    const list = await window.meetmind.sessions.list();
    setSessions(list);
  };

  const openSession = (session) => {
    setSelectedSession(session);
    setView('session');
  };

  const updateConfig = async (key, value) => {
    await window.meetmind.config.set(key, value);
    setConfigState((prev) => ({ ...prev, [key]: value }));
    if (key === 'theme') {
      const t = ['light', 'dark', 'system'].includes(value) ? value : 'dark';
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
      const t = ['light', 'dark', 'system'].includes(updates.theme) ? updates.theme : 'dark';
      setThemeState(t);
      applyTheme(t);
    }
  };

  const setTheme = async (newTheme) => {
    const validTheme = ['light', 'dark', 'system'].includes(newTheme) ? newTheme : 'dark';
    setThemeState(validTheme);
    applyTheme(validTheme);
    await updateConfig('theme', validTheme);
  };

  const toggleTheme = () => {
    // Cycle: dark -> light -> system -> dark
    const nextTheme = theme === 'dark' ? 'light' : theme === 'light' ? 'system' : 'dark';
    setTheme(nextTheme);
  };

  const startRecording = async () => {
    const result = await window.meetmind.recording.start();
    if (result?.success) {
      setIsRecording(true);
      setRecordingSessionId(result.sessionId);
    }
    return result;
  };

  const stopRecording = async () => {
    const result = await window.meetmind.recording.stop();
    if (result?.success) {
      setIsRecording(false);
    }
    return result;
  };

  const ctx = {
    view, setView,
    selectedSession, setSelectedSession,
    sessions, setSessions, refreshSessions,
    config, setConfigState, updateConfig,
    theme, setTheme, toggleTheme,
    isRecording, recordingSessionId,
    startRecording, stopRecording,
    openSession,
  };

  return (
    <AppContext.Provider value={ctx}>
      <div className="flex h-screen overflow-hidden bg-slate-50 dark:bg-[rgb(var(--color-background))] text-slate-900 dark:text-[rgb(var(--color-foreground))]">
        {/* Full-width custom titlebar strip */}
        <TitleBar />

        {/* Sidebar */}
        <Sidebar />

        {/* Main content */}
        <main className="flex-1 flex flex-col overflow-hidden pt-8 bg-slate-50 dark:bg-[rgb(var(--color-background))]">
          {isRecording && (
            <RecordingBar
              sessionId={recordingSessionId}
              onStop={stopRecording}
            />
          )}
          <div className="flex-1 overflow-hidden min-h-0">
            {view === 'dashboard' && (
              <Dashboard onOpenSession={openSession} />
            )}
            {view === 'session' && selectedSession && (
              <NoteViewer
                session={selectedSession}
                onBack={() => setView('dashboard')}
                onRefresh={async () => {
                  const updated = await window.meetmind.sessions.get(selectedSession.id);
                  setSelectedSession(updated);
                }}
              />
            )}
            {view === 'settings' && (
              <Settings
                onSave={async (updates) => {
                  await updateMultipleConfig(updates);
                  if (!showOnboarding) setView('dashboard');
                  setShowOnboarding(false);
                }}
              />
            )}
            {view === 'logs' && (
              <LogsViewer />
            )}
          </div>
        </main>
      </div>

      {/* Onboarding: only when API keys not set; close button dismisses for this session */}
      {keysNotSet && showOnboarding && view !== 'settings' && !isRecording && (
        <OnboardingBanner
          onSetup={() => { setView('settings'); setShowOnboarding(false); }}
          onClose={() => setShowOnboarding(false)}
          hasSessions={sessions.length > 0}
        />
      )}

      {/* Auto-Update Downloaded Floating Banner */}
      {updaterState?.status === 'downloaded' && showUpdateBanner && !isRecording && (
        <UpdateBanner
          version={updaterState.updateInfo?.version}
          onInstall={() => window.meetmind.updater?.install()}
          onClose={() => setShowUpdateBanner(false)}
        />
      )}
    </AppContext.Provider>
  );
}

// ── Custom TitleBar ────────────────────────────────────────────────────────────

function TitleBar() {
  const handleMinimize = () => window.meetmind?.window?.minimize();
  const handleMaximize = () => window.meetmind?.window?.maximize();
  const handleClose = () => window.meetmind?.window?.close();

  return (
    <div className="fixed top-0 left-0 right-0 h-8 z-50 flex items-center justify-between pointer-events-none select-none">
      {/* Draggable header region across full width */}
      <div className="titlebar-drag flex-1 h-full pointer-events-auto" />

      {/* Window Controls (minimize, maximize, close) */}
      <div className="flex items-center titlebar-no-drag h-full pointer-events-auto">
        <button
          type="button"
          onClick={handleMinimize}
          className="h-full px-3 text-slate-500 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-200/60 dark:hover:bg-zinc-800/60 flex items-center justify-center transition-colors"
          title="Minimize"
        >
          <Minus size={12} strokeWidth={2} />
        </button>
        <button
          type="button"
          onClick={handleMaximize}
          className="h-full px-3 text-slate-500 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-200/60 dark:hover:bg-zinc-800/60 flex items-center justify-center transition-colors"
          title="Maximize / Restore"
        >
          <Square size={10} strokeWidth={2} />
        </button>
        <button
          type="button"
          onClick={handleClose}
          className="h-full px-3.5 text-slate-500 dark:text-zinc-400 hover:text-white hover:bg-rose-600 flex items-center justify-center transition-colors"
          title="Close"
        >
          <X size={12} strokeWidth={2} />
        </button>
      </div>
    </div>
  );
}

// ── Sidebar ───────────────────────────────────────────────────────────────────

function Sidebar() {
  const { view, setView, isRecording, startRecording, theme, toggleTheme } = useApp();

  const themeDisplay = theme === 'system' ? 'System' : theme === 'light' ? 'Light' : 'Dark';

  return (
    <aside className="w-56 flex-shrink-0 flex flex-col bg-slate-100/90 dark:bg-zinc-950/80 border-r border-slate-200 dark:border-zinc-800/80 pt-8 backdrop-blur-xl transition-colors duration-200">
      {/* Logo mark */}
      <div className="px-4 pt-1 pb-4 titlebar-drag flex items-center gap-3 select-none">
        <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-emerald-500 to-teal-400 flex items-center justify-center shadow-lg shadow-emerald-500/25 flex-shrink-0">
          <Mic size={18} strokeWidth={2.5} className="text-zinc-950" />
        </div>
        <div>
          <span className="font-bold text-sm text-slate-900 dark:text-white block tracking-tight">MeetMind</span>
          <span className="text-[10px] text-emerald-600 dark:text-emerald-400/90 font-mono font-medium block -mt-0.5">AI Meeting Assistant</span>
        </div>
      </div>

      <nav className="flex-1 px-3 space-y-1 titlebar-no-drag">
        <button
          className={`sidebar-item w-full ${view === 'dashboard' ? 'active' : ''}`}
          onClick={() => setView('dashboard')}
        >
          <LayoutGrid size={16} strokeWidth={2} />
          Dashboard
        </button>
        <button
          className={`sidebar-item w-full ${view === 'settings' ? 'active' : ''}`}
          onClick={() => setView('settings')}
        >
          <SettingsIcon size={16} strokeWidth={2} />
          Settings
        </button>
        <button
          className={`sidebar-item w-full ${view === 'logs' ? 'active' : ''}`}
          onClick={() => setView('logs')}
        >
          <Terminal size={16} strokeWidth={2} />
          Logs
        </button>
      </nav>

      {/* Theme toggle in sidebar */}
      <div className="px-3 pb-3 titlebar-no-drag">
        <button
          type="button"
          onClick={toggleTheme}
          className="w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs font-medium bg-white dark:bg-zinc-900/60 border border-slate-200 dark:border-zinc-800 text-slate-600 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-white hover:border-emerald-500/40 dark:hover:border-zinc-700 transition-all duration-150 shadow-sm dark:shadow-none"
          title={`Theme: ${themeDisplay} (Click to switch)`}
        >
          <span className="flex items-center gap-2 truncate">
            {theme === 'system' ? (
              <Monitor size={14} className="text-sky-500 flex-shrink-0" />
            ) : theme === 'light' ? (
              <Sun size={14} className="text-amber-500 flex-shrink-0" />
            ) : (
              <Moon size={14} className="text-emerald-400 flex-shrink-0" />
            )}
            <span>Theme</span>
          </span>
          <span className="text-[10px] font-semibold capitalize px-2 py-0.5 rounded bg-slate-100 dark:bg-zinc-800 text-slate-700 dark:text-zinc-300 border border-slate-200 dark:border-zinc-700/60 flex-shrink-0">
            {themeDisplay}
          </span>
        </button>
      </div>

      {/* Bottom status CTA */}
      <div className="px-3 py-3 titlebar-no-drag border-t border-slate-200 dark:border-zinc-800/80">
        {!isRecording ? (
          <button onClick={startRecording} className="btn-primary w-full justify-center text-xs py-2.5">
            <span className="w-2 h-2 rounded-full bg-zinc-950 animate-pulse" />
            New Recording
          </button>
        ) : (
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-rose-500/10 border border-rose-500/20">
            <span className="recording-dot w-2 h-2 rounded-full bg-rose-500 flex-shrink-0" />
            <span className="text-rose-600 dark:text-rose-300 text-xs font-medium">Recording Live</span>
          </div>
        )}
      </div>
    </aside>
  );
}

// ── Onboarding Banner ─────────────────────────────────────────────────────────

function OnboardingBanner({ onSetup, onClose, hasSessions }) {
  return (
    <div className="fixed bottom-4 right-4 z-50 max-w-sm bg-white dark:bg-[rgb(var(--color-background-secondary))] border border-slate-200 dark:border-[rgb(var(--color-border))] rounded-xl p-4 shadow-2xl fade-in">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex gap-3">
          <div className="w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-600 dark:text-emerald-400 flex-shrink-0">
            <KeyRound size={16} strokeWidth={2} />
          </div>
          <div>
            <h3 className="font-semibold text-sm mb-1 text-slate-900 dark:text-white">Welcome to MeetMind</h3>
            <p className="text-slate-600 dark:text-[rgb(var(--color-foreground-muted))] text-xs mb-3">
              {hasSessions
                ? 'Add API keys to transcribe and summarize your recordings, and upload to Notion.'
                : 'Set up your API keys to get started with transcription and Notion upload.'}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="flex-shrink-0 p-1 rounded text-slate-400 dark:text-[rgb(var(--color-foreground-subtle))] hover:text-slate-600 dark:hover:text-[rgb(var(--color-foreground-muted))] hover:bg-slate-100 dark:hover:bg-[rgb(var(--color-background-tertiary))] transition-colors"
          aria-label="Close"
        >
          <X size={16} strokeWidth={2} />
        </button>
      </div>
      <button onClick={onSetup} className="btn-primary text-xs">
        Configure API Keys
        <ArrowRight size={13} strokeWidth={2} />
      </button>
    </div>
  );
}

// ── Update Notification Banner ───────────────────────────────────────────────

function UpdateBanner({ version, onInstall, onClose }) {
  return (
    <div className="fixed bottom-4 right-4 z-50 max-w-sm bg-white dark:bg-[rgb(var(--color-background-secondary))] border border-emerald-500/40 rounded-xl p-4 shadow-2xl shadow-emerald-950/40 fade-in">
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="min-w-0 flex gap-3">
          <div className="w-8 h-8 rounded-lg bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center text-emerald-600 dark:text-emerald-400 flex-shrink-0">
            <Sparkles size={16} strokeWidth={2.5} />
          </div>
          <div>
            <h3 className="font-semibold text-sm text-slate-900 dark:text-white">Update Ready to Apply</h3>
            <p className="text-slate-600 dark:text-[rgb(var(--color-foreground-muted))] text-xs mt-0.5">
              MeetMind <span className="font-mono text-emerald-600 dark:text-emerald-400 font-medium">v{version}</span> is downloaded and ready to install.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="flex-shrink-0 p-1 rounded text-slate-400 dark:text-[rgb(var(--color-foreground-subtle))] hover:text-slate-600 dark:hover:text-[rgb(var(--color-foreground-muted))] hover:bg-slate-100 dark:hover:bg-[rgb(var(--color-background-tertiary))] transition-colors"
          aria-label="Close"
        >
          <X size={16} strokeWidth={2} />
        </button>
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onInstall}
          className="btn-primary text-xs flex items-center gap-1.5"
        >
          <ArrowUpCircle size={14} />
          Restart &amp; Update
        </button>
        <button
          type="button"
          onClick={onClose}
          className="btn-secondary text-xs"
        >
          Later
        </button>
      </div>
    </div>
  );
}

// ── Mount ─────────────────────────────────────────────────────────────────────

const root = createRoot(document.getElementById('root'));
root.render(<App />);
