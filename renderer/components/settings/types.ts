import type { CalendarList, Meetmind, ProviderConfigFields, RendererConfig } from '@shared';

/** The settings the form edits, as they are named in config. */
export type SettingsFormKey =
  | 'sttService'
  | 'sttModels'
  | 'llmProvider'
  | 'llmModels'
  | 'llmFallback'
  | 'notionApiKey'
  | 'notionDatabaseId'
  | 'notionUploadTranscript'
  | 'language'
  | 'enableDiarization'
  | 'minSpeakers'
  | 'maxSpeakers'
  | 'systemPrompt'
  | 'geminiSystemPrompt'
  | 'promptOutputMode'
  | 'noteOutputMode'
  | 'autoLaunch'
  | 'autoCheckUpdates'
  | 'autoInstallUpdates'
  | 'hideLogsInSidebar'
  | 'pinNotesViewToggle'
  | 'showAudioWaveform'
  | 'meetingDetection'
  | 'recordUsesDetectedMeeting'
  | 'dashboardRecentLimit'
  | 'pdfExportDir'
  | 'pdfIncludeTranscript'
  | 'recordingRetentionDays';

/** A credential or option owned by a provider (`CredentialField.configKey`). */
export type ProviderFieldKey = keyof ProviderConfigFields;

/**
 * The Settings form's state: the settings it edits plus the credentials of the providers the
 * descriptors list (only those are present, so all of them are optional).
 */
export type SettingsForm = Pick<RendererConfig, SettingsFormKey> & Partial<ProviderConfigFields>;

/** Sets one field of the form. */
export type FormChange = <K extends keyof SettingsForm>(key: K, value: SettingsForm[K]) => void;

/** A calendar as `calendar:list` returns it: the source and how its last sync went. */
export type CalendarEntry = CalendarList['sources'][number];

/** What `calendar:add` resolves with when the calendar was added. */
export type CalendarAdded = Extract<Awaited<ReturnType<Meetmind['calendar']['add']>>, { success: true }>;

/** One step of a "how to get a key" guide. */
export interface GuideStepItem {
  text: string;
  url?: string;
  hint?: string;
}
