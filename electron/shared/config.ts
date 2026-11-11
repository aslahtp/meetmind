// App settings as `getConfig()` returns them. Source: electron/utils/config.js (schema + getConfig()).
// Provider credential keys come from the provider registries (`providerConfigKeys()`); the ones that
// exist today are listed explicitly below, so a new provider that adds a key adds it here too.

import type { CalendarSyncMinutes } from './calendar';
import type { EffectiveTheme } from './overlay';

/** Setting for the app's colour theme (`system` follows the OS). */
export type ThemeSetting = EffectiveTheme | 'system';

/** macOS only: how system audio is captured (electron/audio/mac-capture.js). */
export type MacCaptureStrategy = 'screen' | 'frame' | 'picker';

/** `llmFallback`: any provider/model to retry with; an empty object means disabled. */
export interface LlmFallback {
  provider?: string;
  model?: string;
}

/** Credentials and options contributed by the STT / LLM providers. */
export interface ProviderConfigFields {
  geminiApiKey: string;
  claudeApiKey: string;
  groqApiKey: string;
  sarvamApiKey: string;
  assemblyAiApiKey: string;
  assemblyAiPrompt: string;
  googleApiKey: string;
  googleCloudProjectId: string;
  googleCloudStorageBucket: string;
  googleCloudStorageKeyPath: string;
}

export interface Config extends ProviderConfigFields {
  // Notion. The `*Api*` / `*Page*` pairs are aliases of each other (setConfig keeps them in sync).
  notionToken: string;
  notionApiKey: string;
  notionDatabaseId: string;
  notionPageId: string;
  notionUploadTranscript: boolean;

  // Engines: id of the active provider, and the chosen model per provider id.
  llmProvider: string;
  llmModels: Record<string, string>;
  llmFallback: LlmFallback;
  sttService: string;
  sttModels: Record<string, string>;

  // Notes. `systemPrompt` / `geminiSystemPrompt` and `noteOutputMode` / `promptOutputMode` are aliases.
  systemPrompt: string;
  geminiSystemPrompt: string;
  /** Output format of the notes (default `'json'`). */
  noteOutputMode: string;
  promptOutputMode: string;
  language: string;
  enableDiarization: boolean;
  minSpeakers: number;
  maxSpeakers: number;

  // Audio devices for the FFmpeg fallback.
  systemAudioDevice: string;
  micDevice: string;
  macCaptureStrategy: MacCaptureStrategy;

  // App behaviour.
  autoLaunch: boolean;
  theme: ThemeSetting;
  websocketPort: number;
  onboardingComplete: boolean;
  autoCheckUpdates: boolean;
  autoInstallUpdates: boolean;
  hideLogsInSidebar: boolean;
  pinNotesViewToggle: boolean;
  showAudioWaveform: boolean;
  dashboardRecentLimit: number;

  // Meeting detection.
  meetingDetection: boolean;
  recordUsesDetectedMeeting: boolean;

  // Calendars. Sources hold credentials: `getConfig()` returns them as stored (main process only);
  // `config:get` leaves them out, and the renderer uses the redacted `calendar:*` channels.
  calendars: unknown[];
  calendarSyncMinutes: CalendarSyncMinutes;

  // PDF export and recordings storage.
  pdfExportDir: string;
  pdfIncludeTranscript: boolean;
  /** Days to keep recordings' audio; 0 = forever. */
  recordingRetentionDays: number;
}

/** What the renderer gets from `config:get` (everything but the calendar sources). */
export type RendererConfig = Omit<Config, 'calendars'>;

export type ConfigKey = keyof Config;

/** Input of `config:set-multiple` (`calendars` is ignored there). */
export type ConfigUpdate = Partial<Config>;

/** `config:autoLaunchStatus` */
export interface AutoLaunchStatus {
  openAtLogin: boolean;
  /** Dev builds never register for launch at login. */
  isDev?: boolean;
  /** Windows / Linux: the user turned the startup entry off in the system's settings. */
  disabledInSystem?: boolean;
  error?: string;
}
