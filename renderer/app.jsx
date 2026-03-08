import React, { useState, useEffect, createContext, useContext } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/globals.css';

import Dashboard from './components/Dashboard.jsx';
import NoteViewer from './components/NoteViewer.jsx';
import Settings from './components/Settings.jsx';
import ProcessingOverlay from './components/ProcessingOverlay.jsx';
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
  const [processingState, setProcessingState] = useState(null);  // { stage, percent } | null
  const [showOnboarding, setShowOnboarding] = useState(false);

  // Load config and sessions on mount
  useEffect(() => {
    async function init() {
      if (!window.meetmind) return;
      const cfg = await window.meetmind.config.get();
      setConfigState(cfg);
      if (!cfg.onboardingComplete) setShowOnboarding(true);

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

    const unsubProgress = window.meetmind.on('processing:progress', ({ stage, percent }) => {
      setProcessingState({ stage, percent });
    });

    const unsubComplete = window.meetmind.on('processing:complete', async ({ sessionId }) => {
      setProcessingState(null);
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

    const unsubError = window.meetmind.on('processing:error', () => {
      setProcessingState(null);
    });

    return () => {
      unsubRecordingStarted?.();
      unsubRecordingStopped?.();
      unsubProgress?.();
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
      setProcessingState({ stage: 'transcribing', percent: 0 });
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
      <div className="flex h-screen overflow-hidden bg-[#1a1a1a] text-white">
        {/* Sidebar */}
        <Sidebar />

        {/* Main content */}
        <main className="flex-1 flex flex-col overflow-hidden">
          {isRecording && (
            <RecordingBar
              sessionId={recordingSessionId}
              onStop={stopRecording}
            />
          )}
          <div className="flex-1 overflow-hidden">
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

      {/* Processing overlay */}
      {processingState && (
        <ProcessingOverlay
          stage={processingState.stage}
          percent={processingState.percent}
        />
      )}

      {/* First-run onboarding redirect */}
      {showOnboarding && view !== 'settings' && (
        <OnboardingBanner onSetup={() => setView('settings')} />
      )}
    </AppContext.Provider>
  );
}

// ── Sidebar ───────────────────────────────────────────────────────────────────

function Sidebar() {
  const { view, setView, isRecording, startRecording } = useApp();

  return (
    <aside className="w-56 flex-shrink-0 flex flex-col bg-[#161616] border-r border-[#2a2a2a]">
      {/* App title / drag region */}
      <div className="titlebar-drag h-8 flex items-center px-4">
        <span className="text-xs text-[#666] font-medium select-none">MeetMind</span>
      </div>

      {/* Logo */}
      <div className="px-4 pb-4 pt-2 titlebar-no-drag">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-green-600 flex items-center justify-center">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5">
              <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z"/>
              <path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v3M8 22h8"/>
            </svg>
          </div>
          <span className="font-semibold text-sm">MeetMind</span>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-2 space-y-1 titlebar-no-drag">
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

      {/* Record button */}
      <div className="p-3 titlebar-no-drag border-t border-[#2a2a2a]">
        {!isRecording ? (
          <button onClick={startRecording} className="btn-primary w-full justify-center text-xs">
            <span className="w-2 h-2 rounded-full bg-white"></span>
            New Recording
          </button>
        ) : (
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-red-950 border border-red-800">
            <span className="recording-dot w-2 h-2 rounded-full bg-red-500 flex-shrink-0"></span>
            <span className="text-red-400 text-xs font-medium">Recording...</span>
          </div>
        )}
      </div>
    </aside>
  );
}

// ── Onboarding Banner ─────────────────────────────────────────────────────────

function OnboardingBanner({ onSetup }) {
  return (
    <div className="fixed bottom-4 right-4 z-50 max-w-sm bg-[#212121] border border-[#404040] rounded-xl p-4 shadow-2xl fade-in">
      <h3 className="font-semibold text-sm mb-1">Welcome to MeetMind</h3>
      <p className="text-[#a0a0a0] text-xs mb-3">
        Set up your API keys to get started with transcription and Notion upload.
      </p>
      <button onClick={onSetup} className="btn-primary text-xs">
        Configure API Keys →
      </button>
    </div>
  );
}

// ── Mount ─────────────────────────────────────────────────────────────────────

const root = createRoot(document.getElementById('root'));
root.render(<App />);
