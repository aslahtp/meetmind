import React, { useState, useEffect, createContext, useContext } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/globals.css';

import Dashboard from './components/Dashboard.jsx';
import NoteViewer from './components/NoteViewer.jsx';
import Settings from './components/Settings.jsx';
import RecordingBar from './components/RecordingBar.jsx';

// ── App Context ───────────────────────────────────────────────────────────────

export const AppContext = createContext(null);

export function useApp() {
  return useContext(AppContext);
}

// ── Root App ──────────────────────────────────────────────────────────────────

function App() {
  const [view, setView] = useState('dashboard');           // 'dashboard' | 'session' | 'settings'
  const [selectedSession, setSelectedSession] = useState(null);
  const [sessions, setSessions] = useState([]);
  const [config, setConfigState] = useState(null);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSessionId, setRecordingSessionId] = useState(null);
  const [showOnboarding, setShowOnboarding] = useState(false);

  const keysNotSet = !config?.googleApiKey?.trim() || !config?.geminiApiKey?.trim();

  // Request microphone access at startup so Windows adds this app to the
  // Privacy → Microphone list and allows FFmpeg (a desktop app) to capture audio.
  useEffect(() => {
    if (!navigator.mediaDevices?.getUserMedia) return;
    navigator.mediaDevices.getUserMedia({ audio: true })
      .then((stream) => { stream.getTracks().forEach((t) => t.stop()); })
      .catch(() => { /* permission denied — user will see guidance in Settings */ });
  }, []);

  // ── Renderer-based audio capture (system loopback + mic via Web Audio) ─────
  // The main process sends capture:start / capture:stop commands. We capture
  // system audio through Electron's display-media loopback (WASAPI internally)
  // and the microphone through getUserMedia, mix them, record as webm, and
  // stream chunks to the main process immediately as they are recorded (every 1s).
  // This makes recordings crash-safe — audio is on disk immediately.
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
      if (!cfg?.googleApiKey?.trim() || !cfg?.geminiApiKey?.trim()) setShowOnboarding(true);

      const list = await window.meetmind.sessions.list();
      setSessions(list);
    }
    init();
  }, []);

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
          // Attach the error message directly on the session object so NoteViewer can display it
          setSelectedSession({ ...session, _processingError: error });
          setView('session');
        }
      }
    });

    return () => {
      unsubRecordingStarted?.();
      unsubRecordingStopped?.();
      unsubComplete?.();
      unsubError?.();
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
    isRecording, recordingSessionId,
    startRecording, stopRecording,
    openSession,
  };

  return (
    <AppContext.Provider value={ctx}>
      <div className="flex h-screen overflow-hidden bg-[rgb(var(--color-background))] text-[rgb(var(--color-foreground))]">
        {/* Sidebar */}
        <Sidebar />

        {/* Main content — top padding clears the title bar overlay (window controls) */}
        <main className="flex-1 flex flex-col overflow-hidden pt-10 pb-6">
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
                onSave={(updates) => {
                  Object.entries(updates).forEach(([k, v]) => updateConfig(k, v));
                  if (!showOnboarding) setView('dashboard');
                  setShowOnboarding(false);
                }}
              />
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
    </AppContext.Provider>
  );
}

// ── Sidebar ───────────────────────────────────────────────────────────────────

function Sidebar() {
  const { view, setView, isRecording, startRecording } = useApp();

  return (
    <aside className="w-56 flex-shrink-0 flex flex-col bg-[rgb(var(--color-background))] border-r border-[rgb(var(--color-border))] pb-6">
      {/* Drag region: single app name */}
      <div className="titlebar-drag h-8 flex items-center px-4">
        <span className="text-xs text-[#555] font-medium select-none">MeetMind</span>
      </div>

      {/* Logo + nav in one block (no duplicate name) */}
      <div className="px-4 pt-2 pb-3 titlebar-no-drag flex items-center gap-2">
        <div className="w-8 h-8 rounded-lg bg-[rgb(var(--color-success))] flex items-center justify-center flex-shrink-0">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5">
            <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z"/>
            <path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v3M8 22h8"/>
          </svg>
        </div>
        <span className="font-semibold text-sm truncate">MeetMind</span>
      </div>

      <nav className="flex-1 px-2 space-y-0.5 titlebar-no-drag">
        <button
          className={`sidebar-item w-full ${view === 'dashboard' ? 'active' : ''}`}
          onClick={() => setView('dashboard')}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/>
            <rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>
          </svg>
          Sessions
        </button>
        <button
          className={`sidebar-item w-full ${view === 'settings' ? 'active' : ''}`}
          onClick={() => setView('settings')}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="3"/>
            <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/>
          </svg>
          Settings
        </button>
      </nav>

      {/* Bottom: one recording state (when not recording, show New Recording; when recording, minimal pill — main state is in top bar) */}
      <div className="p-3 titlebar-no-drag border-t border-[rgb(var(--color-border))]">
        {!isRecording ? (
          <button onClick={startRecording} className="btn-primary w-full justify-center text-xs">
            <span className="w-2 h-2 rounded-full bg-white"></span>
            New Recording
          </button>
        ) : (
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[rgb(var(--color-background-tertiary))] border border-[rgb(var(--color-border))]">
            <span className="recording-dot w-2 h-2 rounded-full bg-red-500 flex-shrink-0" />
            <span className="text-[rgb(var(--color-foreground-muted))] text-xs">Recording in progress</span>
          </div>
        )}
      </div>
    </aside>
  );
}

// ── Onboarding Banner ─────────────────────────────────────────────────────────

function OnboardingBanner({ onSetup, onClose, hasSessions }) {
  return (
    <div className="fixed bottom-4 right-4 z-50 max-w-sm bg-[rgb(var(--color-background-secondary))] border border-[rgb(var(--color-border))] rounded-xl p-4 shadow-2xl fade-in">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="font-semibold text-sm mb-1">Welcome to MeetMind</h3>
          <p className="text-[rgb(var(--color-foreground-muted))] text-xs mb-3">
            {hasSessions
              ? 'Add API keys to transcribe and summarize your recordings, and upload to Notion.'
              : 'Set up your API keys to get started with transcription and Notion upload.'}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="flex-shrink-0 p-1 rounded text-[rgb(var(--color-foreground-subtle))] hover:text-[rgb(var(--color-foreground-muted))] hover:bg-[rgb(var(--color-background-tertiary))] transition-colors"
          aria-label="Close"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>
      <button onClick={onSetup} className="btn-primary text-xs">
        Configure API Keys →
      </button>
    </div>
  );
}

// ── Mount ─────────────────────────────────────────────────────────────────────

const root = createRoot(document.getElementById('root'));
root.render(<App />);
