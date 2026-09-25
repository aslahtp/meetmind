import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { SlidersHorizontal, AudioLines, NotebookPen, Blocks, Cpu } from 'lucide-react';
import { useApp } from '../lib/app-context.js';
import { PageHeader, SaveBar, SegmentedControl } from './ui/index.jsx';
import GeneralSection from './settings/GeneralSection.jsx';
import TranscriptionSection from './settings/TranscriptionSection.jsx';
import NotesSection from './settings/NotesSection.jsx';
import IntegrationsSection from './settings/IntegrationsSection.jsx';
import SystemSection from './settings/SystemSection.jsx';

const TABS = [
  { value: 'general', label: 'General', icon: SlidersHorizontal },
  { value: 'transcription', label: 'Transcription', icon: AudioLines },
  { value: 'notes', label: 'Notes', icon: NotebookPen },
  { value: 'integrations', label: 'Integrations', icon: Blocks },
  { value: 'system', label: 'System', icon: Cpu },
];

const TAB_STORAGE_KEY = 'meetmind.settingsTab';

function readStoredTab() {
  try {
    const v = localStorage.getItem(TAB_STORAGE_KEY);
    return TABS.some((t) => t.value === v) ? v : null;
  } catch {
    return null;
  }
}

function storeTab(tab) {
  try { localStorage.setItem(TAB_STORAGE_KEY, tab); } catch {}
}

const DEFAULT_FORM = {
  sttService: 'google',
  googleApiKey: '',
  sarvamApiKey: '',
  assemblyAiApiKey: '',
  assemblyAiPrompt: '',
  geminiApiKey: '',
  geminiModel: 'gemini-3.8-flash',
  secondaryGeminiModel: '',
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
  hideLogsInSidebar: false,
  pinNotesViewToggle: true,
  googleCalendarClientId: '',
  googleCalendarClientSecret: '',
  dashboardRecentLimit: 5,
  pdfExportDir: '',
  pdfIncludeTranscript: false,
};

function formFromConfig(cfg) {
  return {
    sttService: cfg.sttService || 'google',
    googleApiKey: cfg.googleApiKey || '',
    sarvamApiKey: cfg.sarvamApiKey || '',
    assemblyAiApiKey: cfg.assemblyAiApiKey || '',
    assemblyAiPrompt: cfg.assemblyAiPrompt || '',
    geminiApiKey: cfg.geminiApiKey || '',
    geminiModel: cfg.geminiModel || cfg.selectedModel || 'gemini-3.8-flash',
    secondaryGeminiModel: cfg.secondaryGeminiModel || '',
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
    hideLogsInSidebar: cfg.hideLogsInSidebar || false,
    pinNotesViewToggle: cfg.pinNotesViewToggle !== false,
    googleCalendarClientId: cfg.googleCalendarClientId || '',
    googleCalendarClientSecret: cfg.googleCalendarClientSecret || '',
    dashboardRecentLimit: cfg.dashboardRecentLimit || 5,
    pdfExportDir: cfg.pdfExportDir || '',
    pdfIncludeTranscript: cfg.pdfIncludeTranscript === true,
  };
}

export default function Settings({ onSave }) {
  const { confirm, addToast, setNavGuard, keysNotSet } = useApp();
  const [tab, setTab] = useState(() => (keysNotSet ? 'transcription' : readStoredTab() || 'general'));
  const [form, setForm] = useState(DEFAULT_FORM);
  const [initialForm, setInitialForm] = useState(null);
  const [defaultSystemPrompt, setDefaultSystemPrompt] = useState('');
  const [defaultMdSystemPrompt, setDefaultMdSystemPrompt] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const isDirty = useMemo(() => {
    if (!initialForm) return false;
    return Object.keys(form).some((key) => form[key] !== initialForm[key]);
  }, [form, initialForm]);

  useEffect(() => {
    async function load() {
      if (!window.meetmind) return;
      const cfg = await window.meetmind.config.get();
      if (cfg) {
        const loadedForm = formFromConfig(cfg);
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
  }, []);

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

  const handleChange = useCallback((key, val) => {
    setSaved(false);
    setForm((prev) => ({ ...prev, [key]: val }));
  }, []);

  const handleTabChange = (next) => {
    setTab(next);
    storeTab(next);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave(form);
      setInitialForm({ ...form });
      setSaved(true);
    } catch (err) {
      addToast(`Couldn't save settings: ${err?.message || 'unknown error'}`, 'error');
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
