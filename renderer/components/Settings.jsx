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
  Braces,
  Download,
  Terminal,
  AlertTriangle,
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

function Tooltip({ content, children, side = 'top' }) {
  const [open, setOpen] = useState(false);

  return (
    <div
      className="relative inline-flex items-center"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
    >
      {children}
      {open && (
        <div
          className={`absolute ${
            side === 'top'
              ? 'bottom-full left-1/2 -translate-x-1/2 mb-2'
              : 'top-full left-1/2 -translate-x-1/2 mt-2'
          } z-50 pointer-events-none w-64 p-2.5 rounded-lg bg-slate-900/95 dark:bg-zinc-900/95 text-slate-100 dark:text-zinc-200 text-xs leading-relaxed shadow-xl border border-slate-700/80 dark:border-zinc-700/80 backdrop-blur-md text-left fade-in`}
        >
          {content}
          <div
            className={`absolute left-1/2 -translate-x-1/2 border-4 border-transparent ${
              side === 'top'
                ? 'top-full -mt-0.5 border-t-slate-900/95 dark:border-t-zinc-900/95'
                : 'bottom-full -mb-0.5 border-b-slate-900/95 dark:border-b-zinc-900/95'
            }`}
          />
        </div>
      )}
    </div>
  );
}

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
    assemblyAiPrompt: '',
    geminiApiKey: '',
    geminiModel: 'gemini-3.7-flash',
    notionApiKey: '',
    notionDatabaseId: '',
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
  });

  const [initialForm, setInitialForm] = useState(null);
  const [defaultSystemPrompt, setDefaultSystemPrompt] = useState('');
  const [defaultMdSystemPrompt, setDefaultMdSystemPrompt] = useState('');
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
  const [ffmpegStatus, setFfmpegStatus] = useState(null); // null | { ffmpeg, ffprobe }
  const [checkingFfmpeg, setCheckingFfmpeg] = useState(false);
  const [installingFfmpeg, setInstallingFfmpeg] = useState(false);
  const [ffmpegInstallProgress, setFfmpegInstallProgress] = useState(null); // { stage, percent, message }

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
          assemblyAiPrompt: cfg.assemblyAiPrompt || '',
          geminiApiKey: cfg.geminiApiKey || '',
          geminiModel: cfg.geminiModel || cfg.selectedModel || 'gemini-3.7-flash',
          notionApiKey: cfg.notionApiKey || cfg.notionToken || '',
          notionDatabaseId: cfg.notionDatabaseId || cfg.notionPageId || '',
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
        };
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

      if (window.meetmind.updater) {
        const uStatus = await window.meetmind.updater.getStatus();
        setUpdaterStatus(uStatus);
      }
    }
    load();
  }, []);

  // Live updater state (checking/downloading/downloaded/error) pushed from the main process,
  // so progress and status reflect background checks too — not just ones this screen triggered.
  useEffect(() => {
    if (!window.meetmind?.on) return;
    const unsubscribe = window.meetmind.on('updater:status', (status) => {
      setUpdaterStatus(status);
      if (status?.status !== 'checking') setCheckingUpdates(false);
      if (status?.status !== 'downloading') setDownloadingUpdate(false);
    });
    return () => { if (typeof unsubscribe === 'function') unsubscribe(); };
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
      // Result state is picked up via the live 'updater:status' subscription; this call
      // just kicks the check off (and never triggers a download — that's a separate step).
      await window.meetmind.updater.check();
    } finally {
      setCheckingUpdates(false);
    }
  };

  const handleDownloadUpdate = async () => {
    if (!window.meetmind?.updater) return;
    setDownloadingUpdate(true);
    try {
      const result = await window.meetmind.updater.download();
      if (result && result.success === false) {
        setUpdaterStatus((prev) => ({ ...prev, status: 'error', errorMessage: result.error }));
      }
    } finally {
      setDownloadingUpdate(false);
    }
  };

  const handleCheckFfmpeg = async () => {
    if (!window.meetmind?.ffmpeg) return;
    setCheckingFfmpeg(true);
    setFfmpegStatus(null);
    try {
      const result = await window.meetmind.ffmpeg.check();
      setFfmpegStatus(result);
    } catch (err) {
      setFfmpegStatus({ ffmpeg: { found: false }, ffprobe: { found: false }, error: err.message });
    } finally {
      setCheckingFfmpeg(false);
    }
  };

  const handleInstallFfmpeg = async () => {
    if (!window.meetmind?.ffmpeg || installingFfmpeg) return;
    setInstallingFfmpeg(true);
    setFfmpegInstallProgress({ stage: 'download', percent: 0, message: 'Preparing…' });
    try {
      const result = await window.meetmind.ffmpeg.install();
      if (result.success) {
        // Re-check status after successful install
        const checked = await window.meetmind.ffmpeg.check();
        setFfmpegStatus(checked);
      }
    } catch (err) {
      setFfmpegInstallProgress({ stage: 'error', percent: 0, message: err.message });
    } finally {
      setInstallingFfmpeg(false);
    }
  };

  useEffect(() => {
    if (!window.meetmind?.ffmpeg?.onProgress) return;
    const unsub = window.meetmind.ffmpeg.onProgress((data) => {
      setFfmpegInstallProgress(data);
    });
    return () => unsub && unsub();
  }, []);

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

                <div className="space-y-1.5 pt-1">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-medium text-slate-700 dark:text-zinc-300">
                      Transcription Guidance / Key Terms (Optional)
                    </label>
                    <span className="text-[10px] text-slate-400 dark:text-zinc-500 font-mono">AssemblyAI Prompt</span>
                  </div>
                  <input
                    type="text"
                    value={form.assemblyAiPrompt || ''}
                    onChange={(e) => handleChange('assemblyAiPrompt', e.target.value)}
                    placeholder="e.g. Malayalam, Kubernetes, MeetMind, Aslah, API tokens..."
                    className="input font-mono text-xs"
                  />
                  <p className="text-[11px] text-slate-500 dark:text-zinc-500">
                    Specify custom domain terms, names, or languages to improve speech recognition accuracy.
                  </p>
                </div>
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

            {/* System Prompt & Output Mode */}
            <div className="space-y-3 pt-4 border-t border-slate-200 dark:border-zinc-800/80">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div>
                  <label className="text-xs font-semibold uppercase tracking-wider text-slate-700 dark:text-zinc-300">
                    System Prompt &amp; Output Structure
                  </label>
                  <p className="text-[11px] text-slate-500 dark:text-zinc-500 mt-0.5">
                    Customize the instructions and formatting sent to Gemini for generating meeting notes.
                  </p>
                </div>

                {/* Output Mode Switcher */}
                <div className="inline-flex p-0.5 rounded-lg bg-slate-100 dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800">
                  <Tooltip
                    content={
                      <div>
                        <p className="font-semibold text-emerald-400 mb-0.5">JSON (Structured)</p>
                        <p className="text-[11px] text-slate-300 dark:text-zinc-300">
                          Outputs strongly typed schema with discrete summary, key topics, decisions, and action items. Best for Notion Databases.
                        </p>
                      </div>
                    }
                  >
                    <button
                      type="button"
                      onClick={() => {
                        handleChange('promptOutputMode', 'json');
                        handleChange('noteOutputMode', 'json');
                      }}
                      className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold transition-all ${
                        (form.promptOutputMode || form.noteOutputMode) !== 'markdown'
                          ? 'bg-white dark:bg-zinc-800 text-emerald-600 dark:text-emerald-400 shadow-sm border border-slate-200/80 dark:border-zinc-700'
                          : 'text-slate-500 dark:text-zinc-500 hover:text-slate-800 dark:hover:text-zinc-300'
                      }`}
                    >
                      <Braces size={12} strokeWidth={2} />
                      JSON (Structured)
                    </button>
                  </Tooltip>

                  <Tooltip
                    content={
                      <div>
                        <p className="font-semibold text-sky-400 mb-0.5">Markdown Mode</p>
                        <p className="text-[11px] text-slate-300 dark:text-zinc-300">
                          Outputs executive meeting minutes in Markdown with headings, bullet points, and an action items table. Best for Notion Pages.
                        </p>
                      </div>
                    }
                  >
                    <button
                      type="button"
                      onClick={() => {
                        handleChange('promptOutputMode', 'markdown');
                        handleChange('noteOutputMode', 'markdown');
                      }}
                      className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold transition-all ${
                        (form.promptOutputMode || form.noteOutputMode) === 'markdown'
                          ? 'bg-white dark:bg-zinc-800 text-sky-600 dark:text-sky-400 shadow-sm border border-slate-200/80 dark:border-zinc-700'
                          : 'text-slate-500 dark:text-zinc-500 hover:text-slate-800 dark:hover:text-zinc-300'
                      }`}
                    >
                      <FileText size={12} strokeWidth={2} />
                      Markdown
                    </button>
                  </Tooltip>
                </div>
              </div>

              {/* Textarea */}
              <div className="space-y-2">
                <textarea
                  value={
                    form.systemPrompt !== undefined && form.systemPrompt !== ''
                      ? form.systemPrompt
                      : ((form.promptOutputMode || form.noteOutputMode) === 'markdown'
                          ? defaultMdSystemPrompt
                          : defaultSystemPrompt)
                  }
                  onChange={(e) => {
                    handleChange('systemPrompt', e.target.value);
                    handleChange('geminiSystemPrompt', e.target.value);
                  }}
                  rows={8}
                  placeholder="Enter custom instructions for meeting notes generation..."
                  className="input resize-y font-mono text-xs leading-relaxed bg-white dark:bg-zinc-900/90 text-slate-800 dark:text-zinc-200"
                />

                <div className="flex items-center justify-between text-xs">
                  <span className="text-[11px] text-slate-400 dark:text-zinc-500">
                    {form.systemPrompt && form.systemPrompt.trim() !== ''
                      ? 'Custom prompt active'
                      : 'Using default system prompt'}
                  </span>

                  {form.systemPrompt && form.systemPrompt.trim() !== '' && (
                    <button
                      type="button"
                      onClick={() => {
                        handleChange('systemPrompt', '');
                        handleChange('geminiSystemPrompt', '');
                      }}
                      className="btn-ghost text-xs px-2 py-1 text-amber-600 dark:text-amber-400 hover:text-amber-700 dark:hover:text-amber-300 flex items-center gap-1.5"
                    >
                      <RotateCcw size={12} strokeWidth={2} />
                      Reset to Default
                    </button>
                  )}
                </div>
              </div>
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

            {/* Hide Logs in Sidebar */}
            <div className="flex items-center justify-between">
              <div>
                <h4 className="text-sm font-medium text-slate-900 dark:text-zinc-100">Hide Logs from Sidebar</h4>
                <p className="text-xs text-slate-500 dark:text-[#555]">Remove the logs viewer from the sidebar menu</p>
              </div>
              <button
                type="button"
                onClick={() => handleChange('hideLogsInSidebar', !form.hideLogsInSidebar)}
                className={`w-11 h-6 rounded-full transition-colors relative ${
                  form.hideLogsInSidebar ? 'bg-emerald-600 dark:bg-green-600' : 'bg-slate-300 dark:bg-[#333]'
                }`}
              >
                <span
                  className={`block w-4 h-4 rounded-full bg-white transition-transform ${
                    form.hideLogsInSidebar ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </button>
            </div>
          </div>
        </section>

        {/* System Dependencies Section */}
        <section className="space-y-4">
          <div className="flex items-center gap-2">
            <Terminal size={16} className="text-emerald-600 dark:text-emerald-400" />
            <h2 className="text-sm font-semibold text-slate-900 dark:text-zinc-100 tracking-tight">System Dependencies</h2>
          </div>

          <div className="p-4 rounded-xl border border-slate-200 dark:border-[#333] bg-white dark:bg-[rgb(var(--color-tertiary))] space-y-4 shadow-sm dark:shadow-none">
            {/* Header row with check button */}
            <div className="flex items-center justify-between">
              <div>
                <h4 className="text-sm font-medium text-slate-900 dark:text-zinc-100">FFmpeg &amp; FFprobe</h4>
                <p className="text-xs text-slate-500 dark:text-[#555] mt-0.5">
                  Required for audio capture, conversion, duration detection, and system audio mixing
                </p>
              </div>
              <button
                type="button"
                onClick={handleCheckFfmpeg}
                disabled={checkingFfmpeg}
                className="btn-outline text-xs px-3 py-1.5 flex-shrink-0"
              >
                {checkingFfmpeg ? (
                  <>
                    <Loader2 size={12} strokeWidth={2} className="spinner" />
                    Checking…
                  </>
                ) : (
                  <>
                    <RefreshCw size={12} strokeWidth={2} />
                    Check Status
                  </>
                )}
              </button>
            </div>

            {/* Per-binary status rows */}
            {ffmpegStatus && (
              <div className="space-y-2">
                {[
                  { key: 'ffmpeg', label: 'ffmpeg', desc: 'Audio capture &amp; conversion' },
                  { key: 'ffprobe', label: 'ffprobe', desc: 'Media duration detection' },
                ].map(({ key, label, desc }) => {
                  const stat = ffmpegStatus[key];
                  return (
                    <div
                      key={key}
                      className="flex flex-col px-3 py-2 rounded-lg bg-slate-50 dark:bg-zinc-900/50 border border-slate-200 dark:border-zinc-800/80 gap-1"
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <span className="text-xs font-mono font-semibold text-slate-800 dark:text-zinc-200">{label}</span>
                          <span className="text-[11px] text-slate-400 dark:text-zinc-500 ml-2" dangerouslySetInnerHTML={{ __html: desc }} />
                        </div>
                        {stat?.found ? (
                          <div className="flex items-center gap-2">
                            <span className="text-[11px] font-mono text-slate-400 dark:text-zinc-500">
                              {stat.version && stat.version !== 'unknown' ? stat.version : ''}
                              {stat.source === 'bundled' ? ' (bundled)' : ' (system)'}
                            </span>
                            <CheckCircle2 size={14} className="text-emerald-500 dark:text-emerald-400 flex-shrink-0" />
                          </div>
                        ) : (
                          <XCircle size={14} className="text-rose-500 dark:text-rose-400 flex-shrink-0" />
                        )}
                      </div>
                      {stat?.found && stat.path && (
                        <p className="text-[10px] font-mono text-slate-400 dark:text-zinc-500 truncate" title={stat.path}>
                          {stat.path}
                        </p>
                      )}
                    </div>
                  );
                })}

                {/* Show install guide if either is missing */}
                {(!ffmpegStatus.ffmpeg?.found || !ffmpegStatus.ffprobe?.found) && (
                  <div className="pt-1 space-y-3">
                    <p className="text-xs text-rose-600 dark:text-rose-400 flex items-center gap-1.5">
                      <XCircle size={13} />
                      One or more binaries missing — audio features may not work
                    </p>

                    {/* Install progress */}
                    {installingFfmpeg || ffmpegInstallProgress ? (
                      <div className="p-3 rounded-lg bg-slate-50 dark:bg-zinc-900/60 border border-slate-200 dark:border-zinc-700/60 space-y-2">
                        {ffmpegInstallProgress?.stage === 'error' ? (
                          <div className="space-y-2">
                            <p className="text-xs text-rose-600 dark:text-rose-400 flex items-center gap-1.5">
                              <XCircle size={13} />
                              Install failed
                            </p>
                            <p className="text-[11px] text-slate-500 dark:text-zinc-400 font-mono break-all">
                              {ffmpegInstallProgress.message}
                            </p>
                            <button
                              type="button"
                              onClick={() => { setFfmpegInstallProgress(null); handleInstallFfmpeg(); }}
                              className="btn-outline text-xs px-3 py-1.5"
                            >
                              <RotateCcw size={12} strokeWidth={2} />
                              Retry
                            </button>
                          </div>
                        ) : ffmpegInstallProgress?.stage === 'done' ? (
                          <p className="text-xs text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5">
                            <CheckCircle2 size={13} />
                            {ffmpegInstallProgress.message}
                          </p>
                        ) : (
                          <div className="space-y-2">
                            <div className="flex items-center justify-between">
                              <p className="text-xs text-slate-700 dark:text-zinc-300">
                                {ffmpegInstallProgress?.message || 'Preparing\u2026'}
                              </p>
                              <span className="text-[11px] font-mono text-slate-400 dark:text-zinc-500">
                                {ffmpegInstallProgress?.percent ?? 0}%
                              </span>
                            </div>
                            {/* Progress bar */}
                            <div className="w-full h-1.5 bg-slate-200 dark:bg-zinc-800 rounded-full overflow-hidden">
                              <div
                                className="h-full bg-emerald-500 dark:bg-emerald-400 rounded-full transition-all duration-300"
                                style={{ width: `${ffmpegInstallProgress?.percent ?? 0}%` }}
                              />
                            </div>
                            <p className="text-[10px] text-slate-400 dark:text-zinc-500">
                              {ffmpegInstallProgress?.stage === 'download' && 'Downloading from gyan.dev (~80 MB)\u2026'}
                              {ffmpegInstallProgress?.stage === 'extract' && 'Extracting archive\u2026'}
                              {ffmpegInstallProgress?.stage === 'copy' && 'Installing to app directory\u2026'}
                            </p>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="p-3 rounded-lg bg-slate-50 dark:bg-zinc-900/60 border border-slate-200 dark:border-zinc-700/60 space-y-3">
                        {/* Primary: in-app installer */}
                        <div className="space-y-1.5">
                          <p className="text-xs font-semibold text-slate-800 dark:text-zinc-200">Install automatically</p>
                          <p className="text-[11px] text-slate-500 dark:text-zinc-400">
                            Downloads ffmpeg &amp; ffprobe from <span className="font-mono">gyan.dev</span> (~80 MB) and installs them into the app directory.
                          </p>
                          <button
                            type="button"
                            onClick={handleInstallFfmpeg}
                            className="btn-primary text-xs px-4 py-2"
                          >
                            <Download size={13} strokeWidth={2} />
                            Download &amp; Install FFmpeg
                          </button>
                        </div>

                        <div className="h-px bg-slate-200 dark:bg-zinc-800" />

                        {/* Secondary: winget */}
                        <div className="space-y-1">
                          <p className="text-[11px] font-medium text-slate-600 dark:text-zinc-300">Or install via Windows Package Manager</p>
                          <code className="block text-[11px] font-mono bg-slate-900 dark:bg-zinc-950 text-emerald-400 px-3 py-1.5 rounded-lg select-all">
                            winget install Gyan.FFmpeg
                          </code>
                          <p className="text-[10px] text-slate-400 dark:text-zinc-500">Run in PowerShell or Command Prompt, then restart MeetMind and re-check.</p>
                        </div>

                        <div className="h-px bg-slate-200 dark:bg-zinc-800" />

                        <button
                          type="button"
                          onClick={() => window.meetmind.shell.openExternal('https://ffmpeg.org/download.html')}
                          className="inline-flex items-center gap-1 text-[11px] text-emerald-600 dark:text-emerald-400 hover:underline"
                        >
                          <ExternalLink size={11} />
                          Official FFmpeg download page
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </section>

        {/* Application Updates Section */}
        <section className="space-y-4">
          <div className="flex items-center gap-2">
            <ArrowUpCircle size={16} className="text-emerald-600 dark:text-emerald-400" />
            <h2 className="text-sm font-semibold text-slate-900 dark:text-zinc-100 tracking-tight">Application Updates</h2>
          </div>

          <div className="p-4 rounded-xl border border-slate-200 dark:border-[#333] bg-white dark:bg-[rgb(var(--color-tertiary))] space-y-3 shadow-sm dark:shadow-none">
            {/* Post-update integrity warning — surfaces a broken release (e.g. missing bundled
                FFmpeg) right after it installs, instead of failing silently mid-recording. */}
            {updaterStatus?.postUpdateCheck && !updaterStatus.postUpdateCheck.ok && (
              <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-300 dark:border-amber-800/60 space-y-2">
                <p className="text-xs font-semibold text-amber-800 dark:text-amber-300 flex items-center gap-1.5">
                  <AlertTriangle size={13} />
                  Update to v{updaterStatus.postUpdateCheck.version} is missing required files
                </p>
                <p className="text-[11px] text-amber-700 dark:text-amber-400/90">
                  {updaterStatus.postUpdateCheck.missing.join(', ')} could not be found after updating. Audio recording won&apos;t work until this is repaired.
                </p>
                <button
                  type="button"
                  onClick={handleInstallFfmpeg}
                  disabled={installingFfmpeg}
                  className="btn-outline text-xs px-3 py-1.5"
                >
                  <RotateCcw size={12} strokeWidth={2} />
                  Repair Now
                </button>
              </div>
            )}

            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold text-slate-900 dark:text-zinc-200">
                  Current Version: <span className="font-mono text-emerald-600 dark:text-emerald-400">v{appVersion || (typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '')}</span>
                </p>
                {updaterStatus?.updateInfo?.version && updaterStatus.status !== 'not-available' && (
                  <p className="text-xs text-slate-500 dark:text-zinc-400 mt-0.5">
                    Latest Available: <span className="font-mono text-emerald-600 dark:text-emerald-400">v{updaterStatus.updateInfo.version}</span>
                  </p>
                )}
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleCheckUpdates}
                  disabled={checkingUpdates || downloadingUpdate}
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
                    <Download size={12} strokeWidth={2} />
                    Download Update
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

            {/* Download progress */}
            {updaterStatus?.status === 'downloading' && (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <p className="text-xs text-slate-700 dark:text-zinc-300">
                    Downloading v{updaterStatus.updateInfo?.version}…
                  </p>
                  <span className="text-[11px] font-mono text-slate-400 dark:text-zinc-500">
                    {updaterStatus.downloadProgress?.percent ?? 0}%
                  </span>
                </div>
                <div className="w-full h-1.5 bg-slate-200 dark:bg-zinc-800 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-emerald-500 dark:bg-emerald-400 rounded-full transition-all duration-300"
                    style={{ width: `${updaterStatus.downloadProgress?.percent ?? 0}%` }}
                  />
                </div>
                {updaterStatus.downloadProgress?.total > 0 && (
                  <p className="text-[10px] text-slate-400 dark:text-zinc-500">
                    {(updaterStatus.downloadProgress.transferred / 1024 / 1024).toFixed(1)} MB / {(updaterStatus.downloadProgress.total / 1024 / 1024).toFixed(1)} MB
                    {updaterStatus.downloadProgress.bytesPerSecond > 0 && ` · ${(updaterStatus.downloadProgress.bytesPerSecond / 1024 / 1024).toFixed(1)} MB/s`}
                  </p>
                )}
              </div>
            )}

            {updaterStatus?.status === 'downloaded' && (
              <p className="text-xs text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5">
                <CheckCircle2 size={13} /> v{updaterStatus.updateInfo?.version} downloaded and verified — restart to install.
              </p>
            )}

            {updaterStatus?.status === 'not-available' && (
              <p className="text-xs text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5">
                <CheckCircle2 size={13} /> You are running the latest version of MeetMind.
              </p>
            )}

            {updaterStatus?.status === 'error' && updaterStatus?.errorMessage && (
              <p className="text-xs text-rose-600 dark:text-rose-400 flex items-center gap-1.5">
                <XCircle size={13} /> {updaterStatus.errorMessage}
              </p>
            )}

            {updaterStatus?.backgroundChecksSuspended && (
              <p className="text-[11px] text-amber-600 dark:text-amber-400/90 flex items-center gap-1.5">
                <AlertTriangle size={12} />
                Automatic update checks paused after repeated failures — use "Check for Updates" to retry.
              </p>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
