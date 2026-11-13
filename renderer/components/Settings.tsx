import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { SlidersHorizontal, AudioLines, NotebookPen, Blocks, HardDrive, Cpu, type LucideIcon } from 'lucide-react';
import type { ProviderDescriptors, RendererConfig, StorageSummary } from '@shared';
import { useApp } from '../lib/app-context';
import { providerConfigKeys } from '../lib/providers';
import { sameValue, changedFields } from '../lib/settingsForm';
import { readSettingsTab, storeSettingsTab, takeRequestedSettingsTab } from '../lib/settingsTab';
import { retentionPeriod, describeRecordings, deletionToast } from '../lib/storage';
import { errorMessage } from '../lib/errors';
import { PageHeader, SaveBar, SegmentedControl } from './ui/index';
import GeneralSection from './settings/GeneralSection';
import TranscriptionSection from './settings/TranscriptionSection';
import NotesSection from './settings/NotesSection';
import IntegrationsSection from './settings/IntegrationsSection';
import StorageSection from './settings/StorageSection';
import SystemSection from './settings/SystemSection';
import type { FormChange, SettingsForm } from './settings/types';

type SettingsTab = 'general' | 'transcription' | 'notes' | 'integrations' | 'storage' | 'system';

const TABS: { value: SettingsTab; label: string; icon: LucideIcon }[] = [
  { value: 'general', label: 'General', icon: SlidersHorizontal },
  { value: 'transcription', label: 'Transcription', icon: AudioLines },
  { value: 'notes', label: 'Notes', icon: NotebookPen },
  { value: 'integrations', label: 'Integrations', icon: Blocks },
  { value: 'storage', label: 'Storage', icon: HardDrive },
  { value: 'system', label: 'System', icon: Cpu },
];

function isSettingsTab(value: unknown): value is SettingsTab {
  return TABS.some((t) => t.value === value);
}

function readStoredTab(): SettingsTab | null {
  const v = readSettingsTab();
  return isSettingsTab(v) ? v : null;
}

const DEFAULT_FORM: SettingsForm = {
  sttService: 'google',
  sttModels: {},
  llmProvider: 'gemini',
  llmModels: {},
  llmFallback: {},
  notionApiKey: '',
  notionDatabaseId: '',
  notionUploadTranscript: true,
  // Not editable in the UI, but kept in form state so saving round-trips them untouched.
  language: 'ml-IN',
  enableDiarization: true,
  minSpeakers: 1,
  maxSpeakers: 6,
  systemPrompt: '',
  geminiSystemPrompt: '',
  promptOutputMode: 'json',
  noteOutputMode: 'json',
  autoLaunch: false,
  autoCheckUpdates: true,
  autoInstallUpdates: false,
  hideLogsInSidebar: false,
  pinNotesViewToggle: true,
  showAudioWaveform: true,
  meetingDetection: true,
  recordUsesDetectedMeeting: true,
  dashboardRecentLimit: 5,
  pdfExportDir: '',
  pdfIncludeTranscript: false,
  recordingRetentionDays: 0,
};

// Provider credential/option keys come from the provider descriptors, so adding a provider needs
// no edit here.
function formFromConfig(cfg: RendererConfig, providers: ProviderDescriptors): SettingsForm {
  const stored: Record<string, unknown> = { ...cfg };
  const providerFields: Record<string, string> = {};
  for (const key of providerConfigKeys(providers)) providerFields[key] = (stored[key] || '') as string;

  return {
    ...providerFields,
    sttService: cfg.sttService || 'google',
    sttModels: cfg.sttModels || {},
    llmProvider: cfg.llmProvider || 'gemini',
    llmModels: cfg.llmModels || {},
    llmFallback: cfg.llmFallback || {},
    notionApiKey: cfg.notionApiKey || cfg.notionToken || '',
    notionDatabaseId: cfg.notionDatabaseId || cfg.notionPageId || '',
    notionUploadTranscript: cfg.notionUploadTranscript !== false,
    language: cfg.language || 'ml-IN',
    enableDiarization: cfg.enableDiarization ?? true,
    minSpeakers: cfg.minSpeakers || 1,
    maxSpeakers: cfg.maxSpeakers || 6,
    systemPrompt: cfg.systemPrompt || cfg.geminiSystemPrompt || '',
    geminiSystemPrompt: cfg.geminiSystemPrompt || cfg.systemPrompt || '',
    promptOutputMode: cfg.promptOutputMode || cfg.noteOutputMode || 'json',
    noteOutputMode: cfg.noteOutputMode || cfg.promptOutputMode || 'json',
    autoLaunch: cfg.autoLaunch || false,
    autoCheckUpdates: cfg.autoCheckUpdates !== false,
    autoInstallUpdates: cfg.autoInstallUpdates === true,
    hideLogsInSidebar: cfg.hideLogsInSidebar || false,
    pinNotesViewToggle: cfg.pinNotesViewToggle !== false,
    showAudioWaveform: cfg.showAudioWaveform !== false,
    meetingDetection: cfg.meetingDetection !== false,
    recordUsesDetectedMeeting: cfg.recordUsesDetectedMeeting !== false,
    dashboardRecentLimit: cfg.dashboardRecentLimit || 5,
    pdfExportDir: cfg.pdfExportDir || '',
    pdfIncludeTranscript: cfg.pdfIncludeTranscript === true,
    recordingRetentionDays: cfg.recordingRetentionDays ?? 0,
  };
}

interface SettingsProps {
  onSave: (changes: Partial<RendererConfig>) => Promise<void>;
}

export default function Settings({ onSave }: SettingsProps) {
  const { confirm, addToast, setNavGuard, keysNotSet, providers } = useApp();
  const [tab, setTab] = useState<SettingsTab>(() => {
    const requested = takeRequestedSettingsTab();
    if (isSettingsTab(requested)) return requested;
    return keysNotSet ? 'transcription' : readStoredTab() || 'general';
  });
  const [form, setForm] = useState<SettingsForm>(DEFAULT_FORM);
  const [initialForm, setInitialForm] = useState<SettingsForm | null>(null);
  const [defaultSystemPrompt, setDefaultSystemPrompt] = useState('');
  const [defaultMdSystemPrompt, setDefaultMdSystemPrompt] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const isDirty = useMemo(() => {
    if (!initialForm) return false;
    return (Object.keys(form) as (keyof SettingsForm)[]).some((key) => !sameValue(form[key], initialForm[key]));
  }, [form, initialForm]);

  useEffect(() => {
    async function load() {
      if (!window.meetmind) return;
      if (!providers) return; // descriptors decide which credential fields exist
      const cfg = await window.meetmind.config.get();
      if (cfg) {
        // Prefer the OS-level startup state over the stored config so the
        // toggle reflects reality even if the user disabled startup from
        // Task Manager or the registry entry was removed.
        if (window.meetmind.config.autoLaunchStatus) {
          try {
            const status = await window.meetmind.config.autoLaunchStatus();
            if (!status.isDev && !status.error) {
              cfg.autoLaunch = status.openAtLogin;
            }
          } catch { /* fall back to stored config */ }
        }
        const loadedForm = formFromConfig(cfg, providers);
        setForm(loadedForm);
        setInitialForm(loadedForm);
      }

      if (window.meetmind.gemini?.getDefaultSystemPrompt) {
        try {
          const defP = await window.meetmind.gemini.getDefaultSystemPrompt();
          if (defP) setDefaultSystemPrompt(defP);
        } catch {}
      }

      if (window.meetmind.gemini?.getMdDefaultSystemPrompt) {
        try {
          const defMdP = await window.meetmind.gemini.getMdDefaultSystemPrompt();
          if (defMdP) setDefaultMdSystemPrompt(defMdP);
        } catch {}
      }
    }
    load();
  }, [providers]);

  // Guard navigation away from the screen while there are unsaved edits.
  useEffect(() => {
    if (isDirty) {
      setNavGuard(() => confirm({
        title: 'Discard unsaved changes?',
        message: 'Your changes to Settings haven’t been saved.',
        confirmLabel: 'Discard',
        cancelLabel: 'Keep editing',
        destructive: true,
      }));
    } else {
      setNavGuard(null);
    }
  }, [isDirty, setNavGuard, confirm]);

  useEffect(() => () => setNavGuard(null), [setNavGuard]);

  useEffect(() => {
    if (!saved) return;
    const t = setTimeout(() => setSaved(false), 2500);
    return () => clearTimeout(t);
  }, [saved]);

  const handleChange = useCallback<FormChange>((key, val) => {
    setSaved(false);
    setForm((prev) => ({ ...prev, [key]: val }));
  }, []);

  const handleTabChange = (next: SettingsTab) => {
    setTab(next);
    storeSettingsTab(next);
  };

  // A new "Keep recordings" period that would delete recordings right away asks first; Cancel
  // leaves the change unsaved. Returns false to stop the save.
  const confirmRetentionChange = async () => {
    const days = form.recordingRetentionDays;
    if (!days || days === initialForm?.recordingRetentionDays || !window.meetmind?.storage) return true;
    let expiring: StorageSummary['expiring'] | undefined;
    try {
      ({ expiring } = await window.meetmind.storage.summary(days));
    } catch {
      return true; // the startup cleanup applies it later
    }
    if (!expiring?.count) return true;
    return confirm({
      title: 'Delete old recordings?',
      message: `${describeRecordings(expiring.count, expiring.bytes)} ${expiring.count === 1 ? 'is' : 'are'} older than ${retentionPeriod(days)} and will be deleted now. Their notes and transcripts are kept. This can’t be undone.`,
      confirmLabel: 'Save and delete',
      destructive: true,
    });
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const retentionChanged = form.recordingRetentionDays !== initialForm?.recordingRetentionDays;
      if (retentionChanged && !(await confirmRetentionChange())) return;
      await onSave(changedFields(form, initialForm));
      setInitialForm({ ...form });
      setSaved(true);
      if (retentionChanged && form.recordingRetentionDays > 0) {
        const result = await window.meetmind.storage.cleanup();
        if (!result?.success || result.count > 0 || result.failed > 0) {
          const { message, type } = deletionToast(result);
          addToast(message, type);
        }
      }
    } catch (err) {
      addToast(`Couldn't save settings: ${errorMessage(err) || 'unknown error'}`, 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDiscard = () => {
    if (initialForm) setForm(initialForm);
  };

  const showSaveBar = isDirty || saving || saved;

  return (
    <div className="h-full overflow-y-auto fade-in">
      <div className="page">
        <PageHeader
          title="Settings"
          subtitle="Transcription, note generation, integrations and app preferences."
        />

        <div className="mb-32 overflow-x-auto">
          <SegmentedControl label="Settings sections" options={TABS} value={tab} onChange={handleTabChange} revealIcon />
        </div>

        {TABS.map((t) => (
          <div
            key={t.value}
            role="tabpanel"
            aria-label={t.label}
            hidden={tab !== t.value}
          >
            {t.value === 'general' && <GeneralSection form={form} onChange={handleChange} />}
            {t.value === 'transcription' && <TranscriptionSection form={form} onChange={handleChange} />}
            {t.value === 'notes' && (
              <NotesSection
                form={form}
                onChange={handleChange}
                defaultSystemPrompt={defaultSystemPrompt}
                defaultMdSystemPrompt={defaultMdSystemPrompt}
              />
            )}
            {t.value === 'integrations' && <IntegrationsSection form={form} onChange={handleChange} />}
            {t.value === 'storage' && (
              <StorageSection
                form={form}
                onChange={handleChange}
                active={tab === 'storage'}
                savedRetentionDays={initialForm?.recordingRetentionDays}
              />
            )}
            {t.value === 'system' && <SystemSection active={tab === 'system'} />}
          </div>
        ))}

        {showSaveBar && (
          <SaveBar
            className="mt-32"
            dirty={isDirty}
            saving={saving}
            saved={saved}
            onSave={handleSave}
            onDiscard={handleDiscard}
          />
        )}
      </div>
    </div>
  );
}
