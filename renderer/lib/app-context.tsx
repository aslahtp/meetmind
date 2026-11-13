import { createContext, useContext } from 'react';
import type { Dispatch, SetStateAction, SyntheticEvent } from 'react';
import type {
  AppState,
  NotesPreview,
  ProviderDescriptors,
  RecordingResult,
  RendererConfig,
  Session,
  ThemeSetting,
  UpdaterState,
} from '@shared';
import type { ConfirmFn } from '../components/ui/ConfirmDialog';
import type { SetupState } from './providers';

/** The pages the app switches between (there is no router). */
export type AppView = 'dashboard' | 'meetings' | 'session' | 'settings' | 'logs';

export type ToastType = 'info' | 'success' | 'warning' | 'error';

/** A button in a toast, e.g. "Open notes". */
export interface ToastAction {
  label: string;
  onClick: () => unknown;
}

/** The meeting a recording started from the calendar belongs to. */
export interface RecordingRequest {
  meetingUrl?: string;
  meetingTitle?: string;
}

/** The meeting being processed; `sessionId` is null until `trackProcessing` has run. */
export type ProcessingState = Omit<NonNullable<AppState['processing']>, 'sessionId'> & { sessionId: string | null };

/** The meeting open on the session page, with the error its last processing run ended in. */
export type OpenSession = Session & { _processingError?: string };

/** Asked before leaving a page with unsaved state; resolves true to go ahead. */
export type NavGuard = () => boolean | Promise<boolean>;

/** App-wide state and actions provided by <App> in app.tsx. */
export interface AppContextValue {
  view: AppView;
  /** Resolves false when a nav guard kept the user on the current page. */
  setView: (view: AppView) => Promise<boolean>;
  selectedSession: OpenSession | null;
  setSelectedSession: Dispatch<SetStateAction<OpenSession | null>>;
  sessions: Session[];
  setSessions: Dispatch<SetStateAction<Session[]>>;
  /** `ifChanged` skips the reload when no database write happened since the last one. */
  refreshSessions: (opts?: { ifChanged?: boolean }) => Promise<void>;
  sessionsLoading: boolean;
  sessionsError: string | null;
  /** Null until `config:get` has answered. */
  config: RendererConfig | null;
  setConfigState: Dispatch<SetStateAction<RendererConfig | null>>;
  updateConfig: <K extends keyof RendererConfig>(key: K, value: RendererConfig[K]) => Promise<void>;
  updateMultipleConfig: (updates: Partial<RendererConfig>) => Promise<void>;
  /** Null until `providers:list` has answered. */
  providers: ProviderDescriptors | null;
  setup: SetupState;
  theme: ThemeSetting;
  setTheme: (theme: ThemeSetting) => Promise<void>;
  isRecording: boolean;
  recordingSessionId: string | null;
  recordingStartedAt: number | null;
  /** Called as a click handler it receives the event, which is ignored. */
  startRecording: (meeting?: RecordingRequest | SyntheticEvent) => Promise<RecordingResult>;
  stopRecording: () => Promise<RecordingResult>;
  processing: ProcessingState | null;
  trackProcessing: (sessionId: string) => void;
  notesPreview: NotesPreview | null;
  updaterState: UpdaterState | null;
  openSession: (session: OpenSession) => Promise<void>;
  openSessionById: (sessionId: string) => Promise<void>;
  addToast: (message: string, type?: ToastType, action?: ToastAction) => void;
  confirm: ConfirmFn;
  /** Views with unsaved state register a guard; every navigation goes through it. */
  setNavGuard: (guard: NavGuard | null) => void;
  /** True once providers and config have loaded and a credential is still missing. */
  keysNotSet: boolean;
}

// App-wide state (config, sessions, processing, toasts…) provided by <App> in app.tsx.
// Kept out of app.tsx so that file exports only components and React Fast Refresh can
// hot-swap it instead of reloading the whole UI on every edit.
export const AppContext = createContext<AppContextValue | null>(null);

export function useApp(): AppContextValue {
  const value = useContext(AppContext);
  if (!value) throw new Error('useApp() must be used inside <AppContext.Provider>');
  return value;
}
