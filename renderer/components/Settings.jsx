import React, { useState, useEffect, useCallback, useMemo, useTransition } from 'react';
import {
  Save,
  Check,
  Key,
  Mic,
  Cpu,
  Sparkles,
  ExternalLink,
  ChevronDown,
  Eye,
  EyeOff,
  Radio,
  FileText,
  Volume2,
  Sliders,
  Play,
  RotateCcw,
  CheckCircle2,
  XCircle,
  Loader2,
  RefreshCw,
  FolderOpen,
  ArrowUpCircle,
  HelpCircle,
  Layers,
  ChevronRight,
  Database,
  Moon,
  Sun,
  Monitor,
} from 'lucide-react';
import NotionIcon from './NotionIcon.jsx';
import GoogleCloudIcon from './GoogleCloudIcon.jsx';
import GeminiIcon from './GeminiIcon.jsx';
import SarvamIcon from './SarvamIcon.jsx';
import AssemblyAiIcon from './AssemblyAiIcon.jsx';
import { useApp } from '../app.jsx';

// ── Service descriptions ──────────────────────────────────────────────────────

const STT_SERVICES = [
  {
    id: 'google',
    name: 'Google Cloud STT',
    badge: 'v2 Chirp 3',
    icon: GoogleCloudIcon,
    pricing: 'Free tier available (60 mins/mo), then ~$0.016/min',
    description:
      'High accuracy with speaker diarization. Supports English and Malayalam (ml-IN) with code-switching. Best overall for multilingual meetings.',
    requiresKey: 'googleApiKey',
  },
  {
    id: 'sarvam',
    name: 'Sarvam AI',
    badge: 'Saarika v2.5',
    icon: SarvamIcon,
    pricing: 'Pay-as-you-go, INR-based billing (~₹0.50/min)',
    description:
      'Built specifically for Indian languages with excellent Malayalam-English code-switching and accent handling. Requires Sarvam API key.',
    requiresKey: 'sarvamApiKey',
  },
  {
    id: 'assemblyai',
    name: 'AssemblyAI',
    badge: 'Conformer-2',
    icon: AssemblyAiIcon,
    pricing: 'Free tier available (100 hrs), then $0.37/hr',
    description:
      'Production-ready transcription with built-in speaker diarization. Good for English meetings.',
    requiresKey: 'assemblyAiApiKey',
  },
];

const GEMINI_MODELS = [
  {
    id: 'gemini-3.7-flash',
    name: 'Gemini 3.7 Flash',
    badge: 'Default',
    badgeClass: 'badge-green',
    description: 'Fast, high-quality reasoning and structured generation. Best overall balance of speed and accuracy.',
  },
  {
    id: 'gemini-3.6-flash',
    name: 'Gemini 3.6 Flash',
    badge: 'Stable',
    badgeClass: 'badge-blue',
    description: 'Reliable previous-generation Flash model. Good fallback if 3.7 is unavailable.',
  },
  {
    id: 'gemini-3.5-flash',
    name: 'Gemini 3.5 Flash',
    badge: 'Fast',
    badgeClass: 'badge-yellow',
    description: 'Efficient summarization with strong multilingual support for code-switched transcripts.',
  },
  {
    id: 'gemini-3.5-flash-lite',
    name: 'Gemini 3.5 Flash Lite',
    badge: 'Lite',
    badgeClass: 'badge-gray',
    description: 'Lightweight and ultra-fast. Best for short meetings or low-latency note generation.',
  },
  {
    id: 'gemini-3.1-flash-lite',
    name: 'Gemini 3.1 Flash Lite',
    badge: 'Legacy',
    badgeClass: 'badge-gray',
    description: 'Previous lite model for standard meeting summarization tasks.',
  },
  {
    id: 'gemini-3.1-pro-preview',
    name: 'Gemini 3.1 Pro Preview',
    badge: 'Pro',
    badgeClass: 'badge-blue',
    description: 'Highest capability model for complex, lengthy, or multi-speaker technical discussions.',
  },
];

const ONBOARDING_STEPS = [
  {
    id: 'google',
    title: '1. Get Google Cloud STT & Gemini API Key',
    desc: 'Power transcription & note summarization',
    icon: GoogleCloudIcon,
    steps: [
      { text: 'Go to Google AI Studio', url: 'https://aistudio.google.com/app/apikey' },
      { text: 'Click "Get API Key" → "Create API Key"' },
      { text: 'Copy key and paste in both Google Cloud STT and Gemini fields below' },
      { text: '(Optional) For Cloud STT v2, enable Cloud Speech-to-Text API in Google Cloud Console', url: 'https://console.cloud.google.com/apis/library/speech.googleapis.com' },
    ],
  },
  {
    id: 'sarvam',
    title: '2. Get Sarvam AI API Key (Indian Languages)',
    desc: 'Best for Malayalam, Hindi, Tamil & Indic meetings',
    icon: SarvamIcon,
    steps: [
      { text: 'Go to Sarvam AI Dashboard', url: 'https://dashboard.sarvam.ai' },
      { text: 'Sign up / Log in and go to "API Keys"' },
      { text: 'Create a new key and paste in the Sarvam API Key field below' },
    ],
  },
  {
    id: 'assemblyai',
    title: '3. Get AssemblyAI API Key (Alternative)',
    desc: 'Fast English transcription with diarization',
    icon: AssemblyAiIcon,
    steps: [
      { text: 'Go to AssemblyAI Dashboard', url: 'https://www.assemblyai.com/dashboard/signup' },
      { text: 'Sign up and copy your API key from the dashboard home' },
      { text: 'Paste in the AssemblyAI API Key field below' },
    ],
  },
  {
    id: 'notion',
    title: '4. Connect Notion Integration (Database or Page)',
    desc: 'Sync meeting notes into a Notion database or as child pages under any page',
    icon: NotionIcon,
    steps: [
      { text: 'Go to Notion Integrations page', url: 'https://www.notion.so/profile/integrations' },
      { text: 'Click "+ New integration", name it "MeetMind", select your workspace' },
      { text: 'Copy the "Internal Integration Secret" and paste in the API Key field below' },
      { text: 'Open your target Notion page or database → "..." menu → "Connect to" → select "MeetMind"' },
      { text: 'Copy the Page ID, Database ID, or full Notion URL and paste in the field below', hint: 'You can paste the 32-character ID or the full URL directly from your browser' },
    ],
  },
];

// ── Components ────────────────────────────────────────────────────────────────

function PasswordInput({ value, onChange, placeholder, id }) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <input
        id={id}
        type={show ? 'text' : 'password'}
        value={value || ''}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="input pr-10 font-mono text-xs"
        autoComplete="off"
        spellCheck="false"
      />
      <button
        type="button"
        onClick={() => setShow((p) => !p)}
        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-zinc-500 hover:text-slate-700 dark:hover:text-zinc-300 transition-colors"
        tabIndex={-1}
        aria-label={show ? 'Hide key' : 'Show key'}
      >
        {show ? <EyeOff size={14} /> : <Eye size={14} />}
      </button>
    </div>
  );
}

function ServiceCard({ service, selected, onSelect, hasKey }) {
  const Icon = service.icon;
  return (
    <div
      onClick={() => onSelect(service.id)}
      className={`flex items-start gap-3 p-3.5 rounded-xl border transition-all cursor-pointer select-none ${
        selected
          ? 'border-emerald-500/60 bg-emerald-500/10 shadow-md shadow-emerald-500/10'
          : 'border-slate-200 dark:border-zinc-800/80 bg-white dark:bg-zinc-900/60 hover:border-slate-300 dark:hover:border-zinc-700/80 hover:bg-slate-50 dark:hover:bg-zinc-800/40'
      }`}
    >
      {/* Radio indicator */}
      <div
        className={`mt-0.5 w-4 h-4 rounded-full border flex-shrink-0 flex items-center justify-center ${
          selected ? 'border-emerald-500 bg-emerald-500' : 'border-slate-300 dark:border-zinc-700'
        }`}
      >
        {selected && <div className="w-1.5 h-1.5 rounded-full bg-white dark:bg-zinc-950" />}
      </div>

      {/* Service icon */}
      <div className="w-8 h-8 rounded-lg bg-slate-100 dark:bg-zinc-800 border border-slate-200 dark:border-zinc-700/80 flex items-center justify-center flex-shrink-0">
        <Icon size={16} />
      </div>

      {/* Text content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap mb-1">
          <span className="font-semibold text-sm text-slate-900 dark:text-zinc-100">{service.name}</span>
          <span className="badge-gray text-[10px] py-0 px-1.5">{service.badge}</span>
          {hasKey ? (
            <span className="badge-green text-[10px] py-0 px-1.5">Key Set</span>
          ) : (
            <span className="badge-yellow text-[10px] py-0 px-1.5">No Key</span>
          )}
        </div>
        <p className="text-xs text-slate-600 dark:text-zinc-400 leading-relaxed mb-1">{service.description}</p>
        <p className="text-[11px] text-slate-400 dark:text-zinc-500 font-mono">{service.pricing}</p>
      </div>
    </div>
  );
}

function OnboardingAccordion() {
  const [openId, setOpenId] = useState(null);

  const toggle = (id) => {
    setOpenId((prev) => (prev === id ? null : id));
  };

  return (
    <div className="border border-slate-200 dark:border-[#2a2a2a] rounded-xl overflow-hidden bg-white dark:bg-transparent">
      {ONBOARDING_STEPS.map((step) => {
        const isOpen = openId === step.id;
        const Icon = step.icon;
        return (
          <div key={step.id} className="border-b border-slate-200 dark:border-[#2a2a2a] last:border-b-0">
            <button
              type="button"
              onClick={() => toggle(step.id)}
              className="w-full flex items-center justify-between p-3.5 hover:bg-slate-50 dark:hover:bg-[#252525] transition-colors text-left"
            >
              <div className="flex items-center gap-3">
                <div className="w-7 h-7 rounded-lg bg-slate-100 dark:bg-zinc-800 border border-slate-200 dark:border-zinc-700/80 flex items-center justify-center flex-shrink-0">
                  <Icon size={14} />
                </div>
                <div>
                  <h4 className="text-sm font-semibold text-slate-900 dark:text-zinc-100">{step.title}</h4>
                  <p className="text-xs text-slate-500 dark:text-[#555]">{step.desc}</p>
                </div>
              </div>
              <ChevronRight
                size={16}
                className={`text-slate-400 dark:text-zinc-500 transition-transform ${isOpen ? 'rotate-90' : ''}`}
              />
            </button>

            {isOpen && (
              <div className="p-4 bg-slate-50 dark:bg-[rgb(var(--color-secondary))] border-t border-slate-200 dark:border-transparent space-y-2.5 text-xs">
                {step.steps.map((s, idx) => (
                  <div key={idx} className="flex items-start gap-2.5">
                    <span className="w-5 h-5 rounded-full bg-slate-200 dark:bg-zinc-800 text-slate-600 dark:text-[#a0a0a0] flex items-center justify-center flex-shrink-0 font-bold text-[10px]">
                      {idx + 1}
                    </span>
                    <div className="flex-1 min-w-0">
                      <span className="text-slate-700 dark:text-[#a0a0a0]">{s.text}</span>
                      {s.url && (
                        <a
                          href={s.url}
                          target="_blank"
                          rel="noreferrer"
                          className="ml-2 inline-flex items-center gap-0.5 text-emerald-600 dark:text-emerald-400 hover:underline"
                          onClick={(e) => { e.preventDefault(); window.meetmind.shell.openExternal(s.url); }}
                        >
                          Open Link
                          <ExternalLink size={10} />
                        </a>
                      )}
                      {s.hint && <p className="text-slate-400 dark:text-[#555] text-[11px] mt-0.5">{s.hint}</p>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export default function Settings({ onSave }) {
  const { theme, setTheme } = useApp();
  const [form, setForm] = useState({
    sttService: 'google',
    googleApiKey: '',
    sarvamApiKey: '',
    assemblyAiApiKey: '',
    geminiApiKey: '',
    geminiModel: 'gemini-3.7-flash',
    notionApiKey: '',
    notionDatabaseId: '',
    language: 'ml-IN',
    enableDiarization: true,
    minSpeakers: 1,
    maxSpeakers: 6,
    systemPrompt: '',
    promptOutputMode: 'json',
    autoLaunch: false,
    autoCheckUpdates: true,
  });

  const [initialForm, setInitialForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [testingStt, setTestingStt] = useState(false);
  const [sttTestResult, setSttTestResult] = useState(null);
  const [testingNotion, setTestingNotion] = useState(false);
  const [notionTestResult, setNotionTestResult] = useState(null);
  const [testingGemini, setTestingGemini] = useState(false);
  const [geminiTestResult, setGeminiTestResult] = useState(null);
  const [updaterStatus, setUpdaterStatus] = useState(null);
  const [checkingUpdates, setCheckingUpdates] = useState(false);
  const [downloadingUpdate, setDownloadingUpdate] = useState(false);
  const [appVersion, setAppVersion] = useState(typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '');

  const isDirty = useMemo(() => {
    if (!initialForm) return false;
    return Object.keys(form).some((key) => form[key] !== initialForm[key]);
  }, [form, initialForm]);

  useEffect(() => {
    async function load() {
      if (!window.meetmind) return;
      if (window.meetmind.app?.getVersion) {
        try {
          const v = await window.meetmind.app.getVersion();
          if (v) setAppVersion(v);
        } catch {}
      }
      const cfg = await window.meetmind.config.get();
      if (cfg) {
        const loadedForm = {
          sttService: cfg.sttService || 'google',
          googleApiKey: cfg.googleApiKey || '',
          sarvamApiKey: cfg.sarvamApiKey || '',
          assemblyAiApiKey: cfg.assemblyAiApiKey || '',
          geminiApiKey: cfg.geminiApiKey || '',
          geminiModel: cfg.geminiModel || cfg.selectedModel || 'gemini-3.7-flash',
          notionApiKey: cfg.notionApiKey || cfg.notionToken || '',
          notionDatabaseId: cfg.notionDatabaseId || cfg.notionPageId || '',
          language: cfg.language || 'ml-IN',
          enableDiarization: cfg.enableDiarization ?? true,
          minSpeakers: cfg.minSpeakers || 1,
          maxSpeakers: cfg.maxSpeakers || 6,
          systemPrompt: cfg.systemPrompt || cfg.geminiSystemPrompt || '',
          promptOutputMode: cfg.promptOutputMode || cfg.noteOutputMode || 'json',
          autoLaunch: cfg.autoLaunch || false,
          autoCheckUpdates: cfg.autoCheckUpdates !== false,
        };
        setForm(loadedForm);
        setInitialForm(loadedForm);
      }

      if (window.meetmind.updater) {
        const uStatus = await window.meetmind.updater.getStatus();
        setUpdaterStatus(uStatus);
      }
    }
    load();
  }, []);

  const handleChange = (key, val) => {
    setForm((prev) => ({ ...prev, [key]: val }));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave(form);
      setInitialForm({ ...form });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } finally {
      setSaving(false);
    }
  };

  const handleTestStt = async () => {
    setTestingStt(true);
    setSttTestResult(null);
    try {
      let result;
      if (form.sttService === 'google') {
        result = await window.meetmind.api.testGoogle(form.googleApiKey);
      } else if (form.sttService === 'sarvam') {
        result = await window.meetmind.api.testSarvam(form.sarvamApiKey);
      } else {
        result = await window.meetmind.api.testAssemblyAi(form.assemblyAiApiKey);
      }
      setSttTestResult(result);
    } catch (err) {
      setSttTestResult({ success: false, error: err.message });
    } finally {
      setTestingStt(false);
    }
  };

  const handleTestGemini = async () => {
    setTestingGemini(true);
    setGeminiTestResult(null);
    try {
      const result = await window.meetmind.api.testGemini(form.geminiApiKey, form.geminiModel);
      setGeminiTestResult(result);
    } catch (err) {
      setGeminiTestResult({ success: false, error: err.message });
    } finally {
      setTestingGemini(false);
    }
  };

  const handleTestNotion = async () => {
    setTestingNotion(true);
    setNotionTestResult(null);
    try {
      const result = await window.meetmind.notion.testConnection(form.notionApiKey, form.notionDatabaseId);
      setNotionTestResult(result);
    } catch (err) {
      setNotionTestResult({ success: false, error: err.message });
    } finally {
      setTestingNotion(false);
    }
  };

  const handleCheckUpdates = async () => {
    if (!window.meetmind?.updater) return;
    setCheckingUpdates(true);
    try {
      const status = await window.meetmind.updater.check();
      setUpdaterStatus(status);
    } finally {
      setCheckingUpdates(false);
    }
  };

  const handleDownloadUpdate = async () => {
    if (!window.meetmind?.updater) return;
    setDownloadingUpdate(true);
    try {
      await window.meetmind.updater.check();
    } finally {
      setDownloadingUpdate(false);
    }
  };

  return (
    <div className="h-full flex flex-col overflow-hidden bg-slate-50 dark:bg-zinc-950/40 fade-in">
      {/* Header */}
      <div className="flex-shrink-0 px-6 pt-3 pb-3 border-b border-slate-200 dark:border-zinc-800/80 bg-slate-100/50 dark:bg-transparent backdrop-blur-md flex items-center justify-between titlebar-drag select-none">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-slate-900 dark:text-white">Settings</h1>
          <p className="text-slate-500 dark:text-zinc-400 text-xs mt-0.5">
            Configure STT engines, Gemini AI models, Notion integration, and audio devices
          </p>
        </div>

        {(isDirty || saving || saved) && (
          <button
            onClick={handleSave}
            disabled={saving}
            className="btn-primary text-xs px-4 py-2 titlebar-no-drag shadow-emerald-500/25 fade-in"
          >
            {saving ? (
              <>
                <Loader2 size={13} strokeWidth={2} className="spinner" />
                Saving…
              </>
            ) : saved ? (
              <>
                <Check size={13} strokeWidth={2.5} />
                Saved!
              </>
            ) : (
              <>
                <Save size={13} strokeWidth={2} />
                Save Changes
              </>
            )}
          </button>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6 space-y-8 max-w-3xl mx-auto w-full pb-24">
        {/* Onboarding Guide Accordion */}
        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <HelpCircle size={16} className="text-emerald-600 dark:text-emerald-400" />
            <h2 className="text-sm font-semibold text-slate-900 dark:text-zinc-100 tracking-tight">Setup Guides &amp; How-Tos</h2>
          </div>
          <OnboardingAccordion />
        </section>

        {/* STT Service Selection */}
        <section className="space-y-4">
          <div className="flex items-center gap-2">
            <Mic size={16} className="text-emerald-600 dark:text-emerald-400" />
            <h2 className="text-sm font-semibold text-slate-900 dark:text-zinc-100 tracking-tight">Speech-to-Text Engine</h2>
          </div>

          <div className="space-y-2">
            {STT_SERVICES.map((service) => (
              <ServiceCard
                key={service.id}
                service={service}
                selected={form.sttService === service.id}
                onSelect={(id) => handleChange('sttService', id)}
                hasKey={!!form[service.requiresKey]?.trim()}
              />
            ))}
          </div>

          {/* Provider Specific Settings Card */}
          <div className="p-4 rounded-xl border border-slate-200 dark:border-[#333] bg-white dark:bg-[rgb(var(--color-tertiary))] space-y-4 shadow-sm dark:shadow-none">
            {form.sttService === 'google' && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold uppercase tracking-wider text-slate-700 dark:text-zinc-300">
                    Google Cloud STT API Key
                  </label>
                  <a
                    href="https://aistudio.google.com/app/apikey"
                    target="_blank"
                    rel="noreferrer"
                    className="text-[11px] text-emerald-600 dark:text-emerald-400 hover:underline flex items-center gap-1"
                    onClick={(e) => { e.preventDefault(); window.meetmind.shell.openExternal('https://aistudio.google.com/app/apikey'); }}
                  >
                    Get API Key <ExternalLink size={10} />
                  </a>
                </div>
                <PasswordInput
                  id="google-stt-key"
                  value={form.googleApiKey}
                  onChange={(val) => handleChange('googleApiKey', val)}
                  placeholder="AIzaSy..."
                />
                <p className="text-[11px] text-slate-500 dark:text-zinc-500">
                  Tip: You can use the same Google AI Studio / Gemini API key for Google STT.
                </p>
              </div>
            )}

            {form.sttService === 'sarvam' && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold uppercase tracking-wider text-slate-700 dark:text-zinc-300">
                    Sarvam AI API Key
                  </label>
                  <a
                    href="https://dashboard.sarvam.ai"
                    target="_blank"
                    rel="noreferrer"
                    className="text-[11px] text-emerald-600 dark:text-emerald-400 hover:underline flex items-center gap-1"
                    onClick={(e) => { e.preventDefault(); window.meetmind.shell.openExternal('https://dashboard.sarvam.ai'); }}
                  >
                    Sarvam Dashboard <ExternalLink size={10} />
                  </a>
                </div>
                <PasswordInput
                  id="sarvam-key"
                  value={form.sarvamApiKey}
                  onChange={(val) => handleChange('sarvamApiKey', val)}
                  placeholder="sarvam_api_key_..."
                />
                <p className="text-[11px] text-slate-500 dark:text-zinc-500">
                  Provides high accuracy transcription for Indian languages including Malayalam with seamless code-switching.
                </p>
              </div>
            )}

            {form.sttService === 'assemblyai' && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold uppercase tracking-wider text-slate-700 dark:text-zinc-300">
                    AssemblyAI API Key
                  </label>
                  <a
                    href="https://www.assemblyai.com/dashboard"
                    target="_blank"
                    rel="noreferrer"
                    className="text-[11px] text-emerald-600 dark:text-emerald-400 hover:underline flex items-center gap-1"
                    onClick={(e) => { e.preventDefault(); window.meetmind.shell.openExternal('https://www.assemblyai.com/dashboard'); }}
                  >
                    AssemblyAI Dashboard <ExternalLink size={10} />
                  </a>
                </div>
                <PasswordInput
                  id="assembly-key"
                  value={form.assemblyAiApiKey}
                  onChange={(val) => handleChange('assemblyAiApiKey', val)}
                  placeholder="assemblyai_key_..."
                />
              </div>
            )}

            <div className="pt-2 flex items-center gap-3">
              <button
                type="button"
                onClick={handleTestStt}
                disabled={testingStt}
                className="btn-outline text-xs px-3 py-1.5"
              >
                {testingStt ? (
                  <>
                    <Loader2 size={12} strokeWidth={2} className="spinner" />
                    Testing…
                  </>
                ) : (
                  'Test STT Connection'
                )}
              </button>

              {sttTestResult && (
                <div className="flex items-center gap-1.5 text-xs">
                  {sttTestResult.success ? (
                    <span className="text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                      <CheckCircle2 size={13} /> Connection verified
                    </span>
                  ) : (
                    <span className="text-rose-600 dark:text-rose-400 flex items-center gap-1">
                      <XCircle size={13} /> {sttTestResult.error || 'Connection failed'}
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>
        </section>

        {/* Gemini AI Settings */}
        <section className="space-y-4">
          <div className="flex items-center gap-2">
            <Sparkles size={16} className="text-emerald-600 dark:text-emerald-400" />
            <h2 className="text-sm font-semibold text-slate-900 dark:text-zinc-100 tracking-tight">Gemini AI Model &amp; Summarization</h2>
          </div>

          <div className="p-4 rounded-xl border border-slate-200 dark:border-[#333] bg-white dark:bg-[rgb(var(--color-tertiary))] space-y-4 shadow-sm dark:shadow-none">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold uppercase tracking-wider text-slate-700 dark:text-zinc-300">
                  Google Gemini API Key
                </label>
                <a
                  href="https://aistudio.google.com/app/apikey"
                  target="_blank"
                  rel="noreferrer"
                  className="text-[11px] text-emerald-600 dark:text-emerald-400 hover:underline flex items-center gap-1"
                  onClick={(e) => { e.preventDefault(); window.meetmind.shell.openExternal('https://aistudio.google.com/app/apikey'); }}
                >
                  Get API Key <ExternalLink size={10} />
                </a>
              </div>
              <PasswordInput
                id="gemini-key"
                value={form.geminiApiKey}
                onChange={(val) => handleChange('geminiApiKey', val)}
                placeholder="AIzaSy..."
              />
            </div>

            <div className="space-y-2">
              <label className="text-xs font-semibold uppercase tracking-wider text-slate-700 dark:text-zinc-300">
                AI Model Selection
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {GEMINI_MODELS.map((model) => (
                  <div
                    key={model.id}
                    onClick={() => handleChange('geminiModel', model.id)}
                    className={`p-3 rounded-lg border cursor-pointer select-none transition-all ${
                      form.geminiModel === model.id
                        ? 'border-emerald-500/60 bg-emerald-500/10'
                        : 'border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-900/60 hover:bg-slate-100 dark:hover:bg-zinc-800/40'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-1 mb-1">
                      <span className="font-semibold text-xs text-slate-900 dark:text-zinc-200">{model.name}</span>
                      <span className={`${model.badgeClass} text-[10px] py-0 px-1.5`}>{model.badge}</span>
                    </div>
                    <p className="text-[11px] text-slate-500 dark:text-zinc-400 leading-snug">{model.description}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="pt-2 flex items-center gap-3">
              <button
                type="button"
                onClick={handleTestGemini}
                disabled={testingGemini}
                className="btn-outline text-xs px-3 py-1.5"
              >
                {testingGemini ? (
                  <>
                    <Loader2 size={12} strokeWidth={2} className="spinner" />
                    Testing…
                  </>
                ) : (
                  'Test Gemini Connection'
                )}
              </button>

              {geminiTestResult && (
                <div className="flex items-center gap-1.5 text-xs">
                  {geminiTestResult.success ? (
                    <span className="text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                      <CheckCircle2 size={13} /> Gemini verified
                    </span>
                  ) : (
                    <span className="text-rose-600 dark:text-rose-400 flex items-center gap-1">
                      <XCircle size={13} /> {geminiTestResult.error || 'Connection failed'}
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>
        </section>

        {/* Notion Integration */}
        <section className="space-y-4">
          <div className="flex items-center gap-2">
            <NotionIcon size={16} />
            <h2 className="text-sm font-semibold text-slate-900 dark:text-zinc-100 tracking-tight">Notion Integration</h2>
          </div>

          <div className="p-4 rounded-xl border border-slate-200 dark:border-[#333] bg-white dark:bg-[rgb(var(--color-tertiary))] space-y-4 shadow-sm dark:shadow-none">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold uppercase tracking-wider text-slate-700 dark:text-zinc-300">
                  Notion Integration Secret / API Key
                </label>
                <a
                  href="https://www.notion.so/profile/integrations"
                  target="_blank"
                  rel="noreferrer"
                  className="text-[11px] text-emerald-600 dark:text-emerald-400 hover:underline flex items-center gap-1"
                  onClick={(e) => { e.preventDefault(); window.meetmind.shell.openExternal('https://www.notion.so/profile/integrations'); }}
                >
                  Create Integration <ExternalLink size={10} />
                </a>
              </div>
              <PasswordInput
                id="notion-key"
                value={form.notionApiKey}
                onChange={(val) => handleChange('notionApiKey', val)}
                placeholder="secret_..."
              />
            </div>

            <div className="space-y-2">
              <label className="text-xs font-semibold uppercase tracking-wider text-slate-700 dark:text-zinc-300">
                Notion Parent Page or Database ID
              </label>
              <input
                type="text"
                value={form.notionDatabaseId}
                onChange={(e) => handleChange('notionDatabaseId', e.target.value.trim())}
                placeholder="Page ID, Database ID, or full Notion URL"
                className="input font-mono text-xs"
              />
              <p className="text-[11px] text-slate-500 dark:text-zinc-500">
                Paste the 32-character ID or full Notion URL of the target page or database. Make sure you have connected your MeetMind integration from the page/database "..." menu.
              </p>
            </div>

            <div className="pt-2 flex items-center gap-3">
              <button
                type="button"
                onClick={handleTestNotion}
                disabled={testingNotion}
                className="btn-outline text-xs px-3 py-1.5"
              >
                {testingNotion ? (
                  <>
                    <Loader2 size={12} strokeWidth={2} className="spinner" />
                    Testing…
                  </>
                ) : (
                  'Test Notion Connection'
                )}
              </button>

              {notionTestResult && (
                <div className="flex items-center gap-1.5 text-xs">
                  {notionTestResult.success ? (
                    <span className="text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                      <CheckCircle2 size={13} />{' '}
                      {notionTestResult.type === 'page'
                        ? 'Notion page connected'
                        : notionTestResult.type === 'database'
                        ? 'Notion database connected'
                        : 'Notion connected'}
                    </span>
                  ) : (
                    <span className="text-rose-600 dark:text-rose-400 flex items-center gap-1">
                      <XCircle size={13} /> {notionTestResult.error || 'Connection failed'}
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>
        </section>

        {/* Preferences */}
        <section className="space-y-4">
          <div className="flex items-center gap-2">
            <Sliders size={16} className="text-emerald-600 dark:text-emerald-400" />
            <h2 className="text-sm font-semibold text-slate-900 dark:text-zinc-100 tracking-tight">Preferences &amp; Appearance</h2>
          </div>

          <div className="p-4 rounded-xl border border-slate-200 dark:border-[#333] bg-white dark:bg-[rgb(var(--color-tertiary))] space-y-4 shadow-sm dark:shadow-none">
            {/* Theme Toggle */}
            <div className="flex items-center justify-between py-1">
              <div>
                <h4 className="text-sm font-medium text-slate-900 dark:text-zinc-100">Appearance Theme</h4>
                <p className="text-xs text-slate-500 dark:text-[#555]">Follow Windows / system settings or choose a theme</p>
              </div>

              <div className="inline-flex p-1 rounded-xl bg-slate-100 dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800">
                <button
                  type="button"
                  onClick={() => setTheme('system')}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                    theme === 'system'
                      ? 'bg-sky-500/20 dark:bg-sky-500/15 text-sky-700 dark:text-sky-400 shadow-sm ring-1 ring-sky-500/20'
                      : 'text-slate-500 dark:text-zinc-500 hover:text-slate-900 dark:hover:text-zinc-200'
                  }`}
                  title="Follow OS / system theme"
                >
                  <Monitor size={13} className="text-sky-500" />
                  System
                </button>
                <button
                  type="button"
                  onClick={() => setTheme('light')}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                    theme === 'light'
                      ? 'bg-amber-500/20 dark:bg-zinc-800 text-amber-700 dark:text-zinc-100 shadow-sm ring-1 ring-amber-500/20 dark:ring-zinc-700/50'
                      : 'text-slate-500 dark:text-zinc-500 hover:text-slate-900 dark:hover:text-zinc-200'
                  }`}
                  title="Use light theme"
                >
                  <Sun size={13} className="text-amber-500" />
                  Light
                </button>
                <button
                  type="button"
                  onClick={() => setTheme('dark')}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                    theme === 'dark'
                      ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 shadow-sm ring-1 ring-emerald-500/20'
                      : 'text-slate-500 dark:text-zinc-500 hover:text-slate-900 dark:hover:text-zinc-200'
                  }`}
                  title="Use dark theme"
                >
                  <Moon size={13} className="text-emerald-500 dark:text-emerald-400" />
                  Dark
                </button>
              </div>
            </div>

            <div className="h-px bg-slate-200 dark:bg-zinc-800/80" />

            {/* Launch on Startup */}
            <div className="flex items-center justify-between">
              <div>
                <h4 className="text-sm font-medium text-slate-900 dark:text-zinc-100">Launch on Startup</h4>
                <p className="text-xs text-slate-500 dark:text-[#555]">Start MeetMind automatically when Windows starts</p>
              </div>
              <button
                type="button"
                onClick={() => handleChange('autoLaunch', !form.autoLaunch)}
                className={`w-11 h-6 rounded-full transition-colors relative ${
                  form.autoLaunch ? 'bg-emerald-600 dark:bg-green-600' : 'bg-slate-300 dark:bg-[#333]'
                }`}
              >
                <span
                  className={`block w-4 h-4 rounded-full bg-white transition-transform ${
                    form.autoLaunch ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </button>
            </div>

            {/* Auto-check Updates */}
            <div className="flex items-center justify-between">
              <div>
                <h4 className="text-sm font-medium text-slate-900 dark:text-zinc-100">Automatic Updates</h4>
                <p className="text-xs text-slate-500 dark:text-[#555]">Check for and download app updates automatically</p>
              </div>
              <button
                type="button"
                onClick={() => handleChange('autoCheckUpdates', !form.autoCheckUpdates)}
                className={`w-11 h-6 rounded-full transition-colors relative ${
                  form.autoCheckUpdates !== false ? 'bg-emerald-600 dark:bg-green-600' : 'bg-slate-300 dark:bg-[#333]'
                }`}
              >
                <span
                  className={`block w-4 h-4 rounded-full bg-white transition-transform ${
                    form.autoCheckUpdates !== false ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </button>
            </div>
          </div>
        </section>

        {/* Application Updates Section */}
        <section className="space-y-4">
          <div className="flex items-center gap-2">
            <ArrowUpCircle size={16} className="text-emerald-600 dark:text-emerald-400" />
            <h2 className="text-sm font-semibold text-slate-900 dark:text-zinc-100 tracking-tight">Application Updates</h2>
          </div>

          <div className="p-4 rounded-xl border border-slate-200 dark:border-[#333] bg-white dark:bg-[rgb(var(--color-tertiary))] space-y-3 shadow-sm dark:shadow-none">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold text-slate-900 dark:text-zinc-200">
                  Current Version: <span className="font-mono text-emerald-600 dark:text-emerald-400">v{appVersion || (typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '')}</span>
                </p>
                {updaterStatus?.updateInfo?.version && (
                  <p className="text-xs text-slate-500 dark:text-zinc-400 mt-0.5">
                    Latest Available: <span className="font-mono text-emerald-600 dark:text-emerald-400">v{updaterStatus.updateInfo.version}</span>
                  </p>
                )}
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleCheckUpdates}
                  disabled={checkingUpdates}
                  className="btn-outline text-xs px-3 py-1.5"
                >
                  {checkingUpdates ? (
                    <>
                      <Loader2 size={12} strokeWidth={2} className="spinner" />
                      Checking…
                    </>
                  ) : (
                    <>
                      <RefreshCw size={12} strokeWidth={2} />
                      Check for Updates
                    </>
                  )}
                </button>

                {updaterStatus?.status === 'available' && (
                  <button
                    type="button"
                    onClick={handleDownloadUpdate}
                    disabled={downloadingUpdate}
                    className="btn-primary text-xs px-3 py-1.5"
                  >
                    {downloadingUpdate ? (
                      <>
                        <Loader2 size={12} strokeWidth={2} className="spinner" />
                        Downloading…
                      </>
                    ) : (
                      'Download Update'
                    )}
                  </button>
                )}

                {updaterStatus?.status === 'downloaded' && (
                  <button
                    type="button"
                    onClick={() => window.meetmind.updater?.install()}
                    className="btn-primary text-xs px-3 py-1.5"
                  >
                    Restart &amp; Install
                  </button>
                )}
              </div>
            </div>

            {updaterStatus?.status === 'up-to-date' && (
              <p className="text-xs text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5">
                <CheckCircle2 size={13} /> You are running the latest version of MeetMind.
              </p>
            )}

            {updaterStatus?.error && (
              <p className="text-xs text-rose-600 dark:text-rose-400 flex items-center gap-1.5">
                <XCircle size={13} /> {updaterStatus.error}
              </p>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
