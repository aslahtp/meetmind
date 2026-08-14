import React, { useState, useEffect } from 'react';
import {
  Eye,
  EyeOff,
  Loader2,
  Check,
  X,
  ChevronDown,
  ExternalLink,
  KeyRound,
  RotateCcw,
  FileText,
  Braces,
  RefreshCw,
  Download,
  Sparkles,
  ArrowUpCircle,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react';
import { useApp } from '../app.jsx';
import NotionIcon from './NotionIcon.jsx';
import GoogleCloudIcon from './GoogleCloudIcon.jsx';
import GeminiIcon from './GeminiIcon.jsx';
import SarvamIcon from './SarvamIcon.jsx';
import AssemblyAiIcon from './AssemblyAiIcon.jsx';

function Field({ label, hint, children }) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-semibold uppercase tracking-wider text-zinc-300">{label}</label>
      {children}
      {hint && <p className="text-xs text-zinc-500">{hint}</p>}
    </div>
  );
}

function PasswordInput({ value, onChange, placeholder, ...props }) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <input
        {...props}
        type={show ? 'text' : 'password'}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        className="input pr-10 font-mono text-xs"
      />
      <button
        type="button"
        className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300 transition-colors"
        onClick={() => setShow(!show)}
        tabIndex={-1}
      >
        {show ? (
          <EyeOff size={14} strokeWidth={2} />
        ) : (
          <Eye size={14} strokeWidth={2} />
        )}
      </button>
    </div>
  );
}

function TestButton({ onTest, label }) {
  const [status, setStatus] = useState(null); // null | 'testing' | 'ok' | 'error'
  const [error, setError] = useState('');

  const handleTest = async () => {
    setStatus('testing');
    setError('');
    try {
      await onTest();
      setStatus('ok');
      setTimeout(() => setStatus(null), 3000);
    } catch (err) {
      setStatus('error');
      setError(err.message || 'Connection failed');
    }
  };

  return (
    <div className="flex items-center gap-2.5">
      <button
        onClick={handleTest}
        disabled={status === 'testing'}
        className="btn-outline text-xs px-3 py-1.5 disabled:opacity-50"
      >
        {status === 'testing' ? (
          <>
            <Loader2 size={12} strokeWidth={2} className="spinner" />
            Testing Connection…
          </>
        ) : 'Test Connection'}
      </button>
      {status === 'ok' && (
        <span className="text-emerald-400 text-xs font-semibold flex items-center gap-1">
          <Check size={12} strokeWidth={2.5} />
          Connected Successfully
        </span>
      )}
      {status === 'error' && (
        <span className="text-rose-400 text-xs font-medium">{error}</span>
      )}
    </div>
  );
}

function DeviceProbeButton({ device, probing, result, onProbe }) {
  return (
    <div className="flex items-center gap-2.5 mt-1.5">
      <button
        onClick={onProbe}
        disabled={probing}
        className="btn-outline text-xs px-3 py-1.5 disabled:opacity-50"
      >
        {probing ? (
          <>
            <Loader2 size={12} strokeWidth={2} className="spinner" />
            Probing Audio (3s)…
          </>
        ) : 'Probe Level'}
      </button>
      {result && !probing && (
        result.isSilent ? (
          <span className="text-rose-400 text-xs flex items-center gap-1">
            <X size={12} strokeWidth={2.5} />
            Silent (peak {result.peak ?? 0}) — check levels &amp; privacy
          </span>
        ) : (
          <span className="text-emerald-400 text-xs font-semibold flex items-center gap-1">
            <Check size={12} strokeWidth={2.5} />
            Signal Detected (Peak {result.peak})
          </span>
        )
      )}
    </div>
  );
}

const ONBOARDING_STEPS = [
  {
    id: 'google',
    title: 'Google Cloud Speech-to-Text',
    description: 'Enable transcription. Free tier: 60 min/month.',
    steps: [
      'Go to console.cloud.google.com',
      'Create a new project',
      'Enable "Cloud Speech-to-Text API"',
      'Create an API key under Credentials',
    ],
    link: 'https://console.cloud.google.com/apis/library/speech.googleapis.com',
  },
  {
    id: 'sarvam',
    title: 'Sarvam AI',
    description: 'Indian STT with native Malayalam–English code-switching support.',
    steps: [
      'Go to dashboard.sarvam.ai',
      'Create an account or sign in',
      'Generate an API key from the API Keys section',
      'Paste it into the Sarvam AI API Key field in Settings',
    ],
    link: 'https://dashboard.sarvam.ai',
  },
  {
    id: 'assemblyai',
    title: 'AssemblyAI',
    description: 'Alternative STT with strong multilingual and code-switching support.',
    steps: [
      'Go to dashboard.assemblyai.com',
      'Create an account or sign in',
      'Copy your API key from the dashboard',
      'Paste it into the AssemblyAI API Key field in Settings',
    ],
    link: 'https://www.assemblyai.com',
  },
  {
    id: 'gemini',
    title: 'Google Gemini API',
    description: 'Powers AI note generation. Free tier available.',
    steps: [
      'Go to aistudio.google.com',
      'Click "Get API key" → Create API key',
    ],
    link: 'https://aistudio.google.com/app/apikey',
  },
  {
    id: 'notion',
    title: 'Notion Integration',
    description: 'Upload notes directly to your Notion workspace.',
    steps: [
      'Go to notion.so/my-integrations → New integration',
      'Copy the "Internal Integration Token"',
      'Share your target database with the integration',
      'Copy the Database ID from its URL',
    ],
    link: 'https://www.notion.so/my-integrations',
  },
];

export default function Settings({ onSave }) {
  const { config } = useApp();
  const [form, setForm] = useState({
    googleApiKey:              '',
    googleCloudProjectId:      '',
    googleCloudStorageBucket:  '',
    googleCloudStorageKeyPath: '',
    geminiApiKey:              '',
    notionToken:           '',
    notionDatabaseId:      '',
    notionPageId:          '',
    selectedModel:     'gemini-3.5-flash-lite',
    systemAudioDevice: '',
    micDevice:         '',
    autoLaunch:        true,
    sttService:        'google',
    assemblyAiApiKey:  '',
    assemblyAiPrompt:  '',
    sarvamApiKey:      '',
    geminiSystemPrompt: '',
    noteOutputMode: 'json',
    autoCheckUpdates: true,
  });
  const [models, setModels] = useState([]);
  const [devices, setDevices] = useState({ all: [], system: null, mic: null });
  const [loadingDevices, setLoadingDevices] = useState(false);
  const [probeResults, setProbeResults] = useState({});
  const [probingDevice, setProbingDevice] = useState(null);
  const [saved, setSaved] = useState(false);
  const [activeOnboardingStep, setActiveOnboardingStep] = useState(null);
  const [defaultSystemPrompt, setDefaultSystemPrompt] = useState('');
  const [defaultMdSystemPrompt, setDefaultMdSystemPrompt] = useState('');
  const [appVersion, setAppVersion] = useState('');
  const [updaterState, setUpdaterState] = useState(null);
  const [checkingUpdate, setCheckingUpdate] = useState(false);

  useEffect(() => {
    if (config) {
      setForm({
        googleApiKey:          config.googleApiKey          || '',
        googleCloudProjectId:      config.googleCloudProjectId      || '',
        googleCloudStorageBucket:  config.googleCloudStorageBucket  || '',
        googleCloudStorageKeyPath: config.googleCloudStorageKeyPath || '',
        geminiApiKey:              config.geminiApiKey              || '',
        notionToken:           config.notionToken           || '',
        notionDatabaseId:      config.notionDatabaseId      || '',
        notionPageId:          config.notionPageId          || '',
        selectedModel:         config.selectedModel         || 'gemini-3.5-flash-lite',
        systemAudioDevice:     config.systemAudioDevice     || '',
        micDevice:             config.micDevice             || '',
        autoLaunch:            config.autoLaunch !== false,
        sttService:            config.sttService || 'google',
        assemblyAiApiKey:      config.assemblyAiApiKey || '',
        assemblyAiPrompt:      config.assemblyAiPrompt || '',
        sarvamApiKey:          config.sarvamApiKey || '',
        geminiSystemPrompt:    config.geminiSystemPrompt || '',
        noteOutputMode:        config.noteOutputMode || 'json',
        autoCheckUpdates:      config.autoCheckUpdates !== false,
      });
    }
  }, [config]);

  useEffect(() => {
    window.meetmind?.app?.getVersion().then((v) => { if (v) setAppVersion(v); });
    window.meetmind?.updater?.getStatus().then((status) => { if (status) setUpdaterState(status); });

    const unsub = window.meetmind?.on?.('updater:status', (status) => {
      setUpdaterState(status);
    });

    return () => {
      unsub?.();
    };
  }, []);

  useEffect(() => {
    window.meetmind?.models.list().then(setModels);
    window.meetmind?.gemini?.getDefaultSystemPrompt().then((prompt) => {
      if (prompt) setDefaultSystemPrompt(prompt);
    });
    window.meetmind?.gemini?.getMdDefaultSystemPrompt().then((prompt) => {
      if (prompt) setDefaultMdSystemPrompt(prompt);
    });
  }, []);

  const update = (key) => (e) => {
    const val = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    setForm((prev) => ({ ...prev, [key]: val }));
  };

  const WASAPI_ID = '__wasapi_loopback__';

  const handleProbeDevice = async (device, label) => {
    if (!device || device === WASAPI_ID) return;
    setProbingDevice(device);
    try {
      const result = await window.meetmind.recording.probeDevice(device);
      setProbeResults((prev) => ({ ...prev, [device]: result }));
    } catch (err) {
      setProbeResults((prev) => ({ ...prev, [device]: { isSilent: true, error: err.message } }));
    } finally {
      setProbingDevice(null);
    }
  };

  const loadDevices = async () => {
    setLoadingDevices(true);
    try {
      const d = await window.meetmind.recording.listDevices();
      setDevices(d);
      // Always auto-select WASAPI Loopback as the system device
      if (d.system) setForm((p) => ({ ...p, systemAudioDevice: d.system }));
      if (d.mic && !form.micDevice) setForm((p) => ({ ...p, micDevice: d.mic }));
    } catch (err) {
      console.error('Failed to list devices:', err);
    } finally {
      setLoadingDevices(false);
    }
  };

  const handleCheckUpdates = async () => {
    setCheckingUpdate(true);
    try {
      await window.meetmind?.updater?.check();
    } catch (err) {
      console.error('Failed to check for updates:', err);
    } finally {
      setTimeout(() => setCheckingUpdate(false), 1200);
    }
  };

  const handleInstallUpdate = async () => {
    try {
      await window.meetmind?.updater?.install();
    } catch (err) {
      console.error('Failed to install update:', err);
    }
  };

  const handleSave = async () => {
    await window.meetmind.config.setMultiple(form);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
    onSave?.(form);
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-2xl mx-auto px-6 py-6 space-y-8">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-zinc-900 border border-zinc-800 flex items-center justify-center text-emerald-400">
            <KeyRound size={18} strokeWidth={2} />
          </div>
          <div>
            <h1 className="text-lg font-semibold">Settings</h1>
            <p className="text-[#666] text-sm mt-0.5">Configure your API keys and preferences</p>
          </div>
        </div>

        {/* ── API Keys ─────────────────────────────────────────── */}
        <section className="space-y-5">
          <h2 className="font-medium text-sm text-[#a0a0a0] uppercase tracking-wider">API Keys</h2>

          {/* Onboarding guide accordion */}
          <div className="border border-[#2a2a2a] rounded-xl overflow-hidden">
            {ONBOARDING_STEPS.map((step) => (
              <div key={step.id} className="border-b border-[#2a2a2a] last:border-0">
                <button
                  className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-[#252525] transition-colors"
                  onClick={() => setActiveOnboardingStep(activeOnboardingStep === step.id ? null : step.id)}
                >
                  <div>
                    <span className="text-sm font-medium inline-flex items-center gap-2">
                      {step.id === 'google' && <GoogleCloudIcon size={16} />}
                      {step.id === 'sarvam' && <SarvamIcon size={16} />}
                      {step.id === 'assemblyai' && <AssemblyAiIcon size={16} />}
                      {step.id === 'gemini' && <GeminiIcon size={16} />}
                      {step.id === 'notion' && <NotionIcon size={16} />}
                      {step.title}
                    </span>
                    <span className="text-[#555] text-xs ml-2">{step.description}</span>
                  </div>
                  <ChevronDown
                    size={16}
                    strokeWidth={2}
                    className={`text-[#555] flex-shrink-0 transition-transform ${activeOnboardingStep === step.id ? 'rotate-180' : ''}`}
                  />
                </button>
                {activeOnboardingStep === step.id && (
                  <div className="px-4 pb-4 bg-[rgb(var(--color-secondary))]">
                    <ol className="space-y-1.5 mb-3">
                      {step.steps.map((s, i) => (
                        <li key={i} className="text-sm text-[#a0a0a0] flex gap-2">
                          <span className="text-[#555] flex-shrink-0">{i + 1}.</span>
                          {s}
                        </li>
                      ))}
                    </ol>
                    <a
                      href={step.link}
                      className="text-green-500 text-xs hover:underline inline-flex items-center gap-1"
                      target="_blank" rel="noreferrer"
                    >
                      Open {step.title}
                      <ExternalLink size={11} strokeWidth={2} />
                    </a>
                  </div>
                )}
              </div>
            ))}
          </div>

          <Field
            label="Transcription Service"
            hint="Choose which Speech-to-Text provider to use for transcription."
          >
            <select
              value={form.sttService}
              onChange={update('sttService')}
              className="input"
            >
              <option value="google">Google Speech-to-Text</option>
              <option value="assemblyai">AssemblyAI</option>
              <option value="sarvam">Sarvam AI</option>
            </select>
          </Field>

          {form.sttService === 'google' && (
            <div className="space-y-4 p-3 rounded-lg border border-[#333] bg-[rgb(var(--color-tertiary))]">
              <div className="space-y-1">
                <p className="text-sm font-medium text-[#d0d0d0] inline-flex items-center gap-2">
                  <GoogleCloudIcon size={16} />
                  Google Speech-to-Text settings
                </p>
                <p className="text-xs text-[#aaa]">
                  Uses Google Cloud Speech-to-Text with support for long meetings and English/Malayalam recognition.
                  Configure API key, project, and optional GCS bucket for BatchRecognize.
                </p>
              </div>

              <Field
                label={(
                  <span className="inline-flex items-center gap-2">
                    <GoogleCloudIcon size={16} />
                    Google Cloud API Key
                  </span>
                )}
                hint="Used for Speech-to-Text transcription."
              >
                <PasswordInput
                  value={form.googleApiKey}
                  onChange={update('googleApiKey')}
                  placeholder="AIzaSy…"
                />
                <TestButton
                  onTest={async () => {
                    const r = await window.meetmind.api.testGoogle(form.googleApiKey, form.googleCloudProjectId);
                    if (!r.success) throw new Error(r.error);
                  }}
                />
              </Field>

              <Field
                label={(
                  <span className="inline-flex items-center gap-2">
                    <GoogleCloudIcon size={16} />
                    Google Cloud Project ID
                  </span>
                )}
                hint="Required for Speech-to-Text v2. Your GCP project ID from Cloud Console."
              >
                <input
                  type="text"
                  value={form.googleCloudProjectId}
                  onChange={update('googleCloudProjectId')}
                  placeholder="my-project-id"
                  className="input"
                />
              </Field>

              <Field
                label={(
                  <span className="inline-flex items-center gap-2">
                    <GoogleCloudIcon size={16} />
                    GCS bucket (optional)
                  </span>
                )}
                hint="For v2 BatchRecognize: upload WAV here, then transcribe. See docs/GCS-SETUP.md for bucket + service account setup."
              >
                <input
                  type="text"
                  value={form.googleCloudStorageBucket}
                  onChange={update('googleCloudStorageBucket')}
                  placeholder="my-meetmind-bucket"
                  className="input"
                />
              </Field>

              <Field
                label={(
                  <span className="inline-flex items-center gap-2">
                    <GoogleCloudIcon size={16} />
                    Service account key path (optional)
                  </span>
                )}
                hint="Path to service account JSON key (needs Storage Object Admin on bucket). Or set GOOGLE_APPLICATION_CREDENTIALS."
              >
                <input
                  type="text"
                  value={form.googleCloudStorageKeyPath}
                  onChange={update('googleCloudStorageKeyPath')}
                  placeholder="C:\\path\\to\\key.json"
                  className="input"
                />
              </Field>
            </div>
          )}

          {form.sttService === 'sarvam' && (
            <div className="space-y-4 p-3 rounded-lg border border-[#333] bg-[rgb(var(--color-tertiary))]">
              <div className="space-y-1">
                <p className="text-sm font-medium text-[#d0d0d0] inline-flex items-center gap-2">
                  <SarvamIcon size={16} />
                  Sarvam AI settings
                </p>
                <p className="text-xs text-[#aaa]">
                  Uses Sarvam&apos;s saaras:v3 model in codemix mode with automatic language detection.
                  Works well for meetings that mix Malayalam and English — English stays in Latin script,
                  Indic languages in their native script. Speaker diarization is enabled.
                </p>
              </div>

              <Field
                label={(
                  <span className="inline-flex items-center gap-2">
                    <SarvamIcon size={16} />
                    Sarvam AI API Key
                  </span>
                )}
                hint="Required. Get an API key from dashboard.sarvam.ai."
              >
                <PasswordInput
                  value={form.sarvamApiKey}
                  onChange={update('sarvamApiKey')}
                  placeholder="sk_..."
                />
                <TestButton
                  onTest={async () => {
                    const r = await window.meetmind.api.testSarvam(form.sarvamApiKey);
                    if (!r.success) throw new Error(r.error);
                  }}
                />
              </Field>
            </div>
          )}

          {form.sttService === 'assemblyai' && (
            <div className="space-y-4 p-3 rounded-lg border border-[#333] bg-[rgb(var(--color-tertiary))]">
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-1">
                  <p className="text-sm font-medium text-[#d0d0d0] inline-flex items-center gap-2">
                    <AssemblyAiIcon size={16} />
                    AssemblyAI settings
                    <span className="ml-1 inline-flex items-center rounded-full border border-yellow-500/60 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-yellow-400/90">
                      Beta
                    </span>
                  </p>
                  <p className="text-xs text-[#aaa]">
                    Uses AssemblyAI&apos;s multilingual model with native code-switching between English and Malayalam.
                    The optional prompt lets you nudge transcription style for your team.
                  </p>
                </div>
              </div>

              <Field
                label={(
                  <span className="inline-flex items-center gap-2">
                    <AssemblyAiIcon size={16} />
                    AssemblyAI API Key
                  </span>
                )}
                hint="Required. Get an API key from your AssemblyAI dashboard."
              >
                <PasswordInput
                  value={form.assemblyAiApiKey}
                  onChange={update('assemblyAiApiKey')}
                  placeholder="aai_..."
                />
                <TestButton
                  onTest={async () => {
                    const r = await window.meetmind.api.testAssemblyAi(form.assemblyAiApiKey);
                    if (!r.success) throw new Error(r.error);
                  }}
                />
              </Field>

              <Field
                label={(
                  <span className="inline-flex items-center gap-2">
                    <AssemblyAiIcon size={16} />
                    AssemblyAI Prompt (optional)
                  </span>
                )}
                hint="Short instruction to fine-tune transcription behavior. Leave empty to use the default model behavior."
              >
                <textarea
                  value={form.assemblyAiPrompt}
                  onChange={update('assemblyAiPrompt')}
                  placeholder="Example: Audio is in English and Malayalam. Transcribe exactly what is spoken in the original language, preserving natural code-switching without translation."
                  rows={3}
                  className="input resize-none"
                />
              </Field>
            </div>
          )}

          <Field
            label={(
              <span className="inline-flex items-center gap-2">
                <GeminiIcon size={16} />
                Gemini API Key
              </span>
            )}
            hint="Used for AI note generation"
          >
            <PasswordInput
              value={form.geminiApiKey}
              onChange={update('geminiApiKey')}
              placeholder="AIzaSy…"
            />
            <TestButton
              onTest={async () => {
                const r = await window.meetmind.api.testGemini(form.geminiApiKey, form.selectedModel);
                if (!r.success) throw new Error(r.error);
              }}
            />
          </Field>

          <Field
            label={(
              <span className="inline-flex items-center gap-2">
                <NotionIcon size={16} />
                Notion Integration Token
              </span>
            )}
            hint='Format: secret_xxx — from notion.so/my-integrations'
          >
            <PasswordInput
              value={form.notionToken}
              onChange={update('notionToken')}
              placeholder="secret_…"
            />
          </Field>

          <Field
            label={(
              <span className="inline-flex items-center gap-2">
                <NotionIcon size={16} />
                Notion Parent Page / Database ID
              </span>
            )}
            hint="Open the target page or database in Notion → share with your integration → copy the 32-char ID from the URL"
          >
            <input
              type="text"
              value={form.notionPageId}
              onChange={update('notionPageId')}
              placeholder="32-character page ID…"
              className="input"
            />
            <TestButton
              onTest={async () => {
                const r = await window.meetmind.notion.testConnection(form.notionToken, form.notionPageId);
                if (!r.success) throw new Error(r.error);
              }}
            />
          </Field>
        </section>

        {/* ── Model Selector ───────────────────────────────────── */}
        <section className="space-y-5">
          <h2 className="font-medium text-sm text-[#a0a0a0] uppercase tracking-wider">AI Model</h2>
          <Field
            label={(
              <span className="inline-flex items-center gap-2">
                <GeminiIcon size={16} />
                Gemini Model
              </span>
            )}
            hint="Flash is faster; Pro gives the most detailed notes"
          >
            <select
              value={form.selectedModel}
              onChange={update('selectedModel')}
              className="input font-mono text-xs"
            >
              {models.map((model) => (
                <option key={model} value={model}>
                  {model}
                </option>
              ))}
            </select>
          </Field>

          <Field
            label="System Prompt"
            hint="The instructions sent to Gemini when generating meeting notes."
          >
            {/* Output mode toggle */}
            <div className="flex items-center gap-2 mb-2.5">
              <span className="text-xs text-zinc-500 font-medium">Output format:</span>
              <div className="inline-flex p-0.5 rounded-lg bg-zinc-900 border border-zinc-800">
                <button
                  type="button"
                  onClick={() => {
                    setForm((p) => ({ ...p, noteOutputMode: 'json', geminiSystemPrompt: '' }));
                  }}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${
                    form.noteOutputMode !== 'markdown'
                      ? 'bg-emerald-500/15 text-emerald-400 shadow-sm'
                      : 'text-zinc-500 hover:text-zinc-300'
                  }`}
                >
                  <Braces size={12} strokeWidth={2} />
                  JSON
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setForm((p) => ({ ...p, noteOutputMode: 'markdown', geminiSystemPrompt: '' }));
                  }}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${
                    form.noteOutputMode === 'markdown'
                      ? 'bg-sky-500/15 text-sky-400 shadow-sm'
                      : 'text-zinc-500 hover:text-zinc-300'
                  }`}
                >
                  <FileText size={12} strokeWidth={2} />
                  Markdown
                </button>
              </div>
              {form.noteOutputMode !== 'markdown' ? (
                <span className="text-[11px] text-emerald-400/70 ml-1">
                  Produces structured JSON — rendered with rich participant cards &amp; interactive action items
                </span>
              ) : (
                <span className="text-[11px] text-sky-400/70 ml-1">
                  Produces a plain markdown document — rendered as prose in the viewer
                </span>
              )}
            </div>


            {/* Prompt textarea */}
            {(() => {
              const ismd = form.noteOutputMode === 'markdown';
              const activeDefault = ismd ? defaultMdSystemPrompt : defaultSystemPrompt;
              const currentVal = form.geminiSystemPrompt || activeDefault;
              const isDirty = form.geminiSystemPrompt !== '' && form.geminiSystemPrompt !== activeDefault;
              return (
                <>
                  <textarea
                    value={currentVal}
                    onChange={(e) => setForm((p) => ({ ...p, geminiSystemPrompt: e.target.value }))}
                    rows={8}
                    className="input resize-y font-mono text-xs leading-relaxed"
                  />
                  {isDirty && (
                    <button
                      type="button"
                      onClick={() => setForm((p) => ({ ...p, geminiSystemPrompt: '' }))}
                      className="btn-ghost text-xs px-2 py-1 mt-1.5 text-yellow-400/80 hover:text-yellow-300 flex items-center gap-1.5"
                    >
                      <RotateCcw size={12} strokeWidth={2} />
                      Reset to Default
                    </button>
                  )}
                </>
              );
            })()}
          </Field>
        </section>

        {/* ── Audio Devices ─────────────────────────────────────── */}
        <section className="space-y-5">
          <div className="flex items-center justify-between">
            <h2 className="font-medium text-sm text-[#a0a0a0] uppercase tracking-wider">Audio Devices</h2>
            <button
              onClick={loadDevices}
              disabled={loadingDevices}
              className="btn-ghost text-xs px-2 py-1 disabled:opacity-50"
            >
              {loadingDevices ? (
                <>
                  <Loader2 size={12} strokeWidth={2} className="spinner" />
                  Detecting…
                </>
              ) : 'Detect Devices'}
            </button>
          </div>

          <div className="p-3 bg-[rgb(var(--color-secondary))] border border-[#333] rounded-lg text-xs space-y-2.5">
            <p className="text-[#a0a0a0] font-medium">
              <span className="text-green-400">●</span> WASAPI Loopback captures all system audio — YouTube, Spotify, calls — even through headphones. No setup required.
            </p>
            <p className="text-[#555]">
              Stereo Mix (legacy) only works with built-in Realtek speakers and requires manual enabling in Windows Sound settings.
            </p>
            <div className="border-t border-[#2a2a2a] pt-2 space-y-1">
              <p className="text-yellow-400/80 font-medium">If recordings are silent:</p>
              <p className="text-[#666]">
                1. Open <strong className="text-[#999]">Windows Settings → Privacy &amp; security → Microphone</strong>
              </p>
              <p className="text-[#666]">
                2. Enable <strong className="text-[#999]">"Let desktop apps access your microphone"</strong> (covers FFmpeg and recording tools)
              </p>
              <p className="text-[#666]">
                3. In <strong className="text-[#999]">Windows Sound → Recording</strong>, right-click your Microphone → Properties → Levels → set to 80–100 and unmute
              </p>
            </div>
          </div>

          <Field label="System Audio Device">
            <select
              value={form.systemAudioDevice}
              onChange={update('systemAudioDevice')}
              className="input"
            >
              <option value="">— Detect devices first —</option>
              {devices.all?.map((d) => {
                const id = d?.id ?? d;
                const label = d?.label ?? d;
                return <option key={id} value={id}>{label}</option>;
              })}
              {form.systemAudioDevice && !devices.all?.some((d) => (d?.id ?? d) === form.systemAudioDevice) && (
                <option value={form.systemAudioDevice}>
                  {form.systemAudioDevice === WASAPI_ID ? 'WASAPI Loopback (All system audio — recommended)' : form.systemAudioDevice}
                </option>
              )}
            </select>
            {form.systemAudioDevice && form.systemAudioDevice !== WASAPI_ID && (
              <DeviceProbeButton
                device={form.systemAudioDevice}
                probing={probingDevice === form.systemAudioDevice}
                result={probeResults[form.systemAudioDevice]}
                onProbe={() => handleProbeDevice(form.systemAudioDevice)}
              />
            )}
          </Field>

          <Field label="Microphone Device">
            <select
              value={form.micDevice}
              onChange={update('micDevice')}
              className="input"
            >
              <option value="">— None / detect devices —</option>
              {devices.all?.filter((d) => (d?.id ?? d) !== WASAPI_ID).map((d) => {
                const id = d?.id ?? d;
                const label = d?.label ?? d;
                return <option key={id} value={id}>{label}</option>;
              })}
              {form.micDevice && !devices.all?.some((d) => (d?.id ?? d) === form.micDevice) && (
                <option value={form.micDevice}>{form.micDevice}</option>
              )}
            </select>
            {form.micDevice && (
              <DeviceProbeButton
                device={form.micDevice}
                probing={probingDevice === form.micDevice}
                result={probeResults[form.micDevice]}
                onProbe={() => handleProbeDevice(form.micDevice)}
              />
            )}
          </Field>
        </section>

        {/* ── Preferences ──────────────────────────────────────── */}
        <section className="space-y-4">
          <h2 className="font-medium text-sm text-[#a0a0a0] uppercase tracking-wider">Preferences</h2>

          <label className="flex items-center justify-between cursor-pointer">
            <div>
              <p className="text-sm font-medium">Launch at startup</p>
              <p className="text-[#555] text-xs">Start MeetMind when Windows starts</p>
            </div>
            <div
              className={`w-10 h-6 rounded-full transition-colors relative ${form.autoLaunch ? 'bg-green-600' : 'bg-[#333]'}`}
              onClick={() => setForm((p) => ({ ...p, autoLaunch: !p.autoLaunch }))}
            >
              <div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-all ${form.autoLaunch ? 'left-5' : 'left-1'}`} />
            </div>
          </label>
        </section>

        {/* ── Application Updates ─────────────────────────────────── */}
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="font-medium text-sm text-[#a0a0a0] uppercase tracking-wider">Application Updates</h2>
              <p className="text-zinc-500 text-xs mt-0.5">
                Current Version: <span className="font-mono text-zinc-300 font-semibold">{appVersion ? `v${appVersion}` : (updaterState?.currentVersion ? `v${updaterState.currentVersion}` : 'v1.6.0')}</span>
              </p>
            </div>
            <button
              type="button"
              onClick={handleCheckUpdates}
              disabled={checkingUpdate || updaterState?.status === 'checking' || updaterState?.status === 'downloading'}
              className="btn-secondary text-xs px-3 py-1.5 flex items-center gap-2"
            >
              <RefreshCw size={13} className={checkingUpdate || updaterState?.status === 'checking' ? 'animate-spin' : ''} />
              {checkingUpdate || updaterState?.status === 'checking' ? 'Checking...' : 'Check for Updates'}
            </button>
          </div>

          {/* Update Downloaded Card */}
          {updaterState?.status === 'downloaded' && (
            <div className="p-4 rounded-xl bg-emerald-950/40 border border-emerald-500/30 flex items-center justify-between gap-4">
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-lg bg-emerald-500/20 text-emerald-400 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <Sparkles size={16} />
                </div>
                <div>
                  <h4 className="text-sm font-semibold text-emerald-200">
                    MeetMind v{updaterState.updateInfo?.version} Ready to Install
                  </h4>
                  <p className="text-xs text-emerald-300/80 mt-0.5">
                    Update has been downloaded. Restart to apply the latest version.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={handleInstallUpdate}
                className="btn-primary text-xs px-4 py-2 flex items-center gap-1.5 flex-shrink-0"
              >
                <ArrowUpCircle size={14} />
                Restart &amp; Update
              </button>
            </div>
          )}

          {/* Update Downloading Progress */}
          {updaterState?.status === 'downloading' && (
            <div className="p-4 rounded-xl bg-zinc-900/80 border border-zinc-800 space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium text-zinc-300 flex items-center gap-2">
                  <Download size={13} className="text-emerald-400 animate-bounce" />
                  Downloading Update v{updaterState.updateInfo?.version || ''}...
                </span>
                <span className="font-mono text-emerald-400 font-semibold">
                  {updaterState.downloadProgress?.percent || 0}%
                </span>
              </div>
              <div className="w-full bg-zinc-800 rounded-full h-1.5 overflow-hidden">
                <div
                  className="bg-gradient-to-r from-emerald-500 to-teal-400 h-full transition-all duration-300"
                  style={{ width: `${updaterState.downloadProgress?.percent || 0}%` }}
                />
              </div>
            </div>
          )}

          {/* Up to Date Confirmation */}
          {updaterState?.status === 'not-available' && (
            <div className="p-3 rounded-lg bg-zinc-900/50 border border-zinc-800/80 flex items-center gap-2.5 text-xs text-zinc-400">
              <CheckCircle2 size={15} className="text-emerald-400 flex-shrink-0" />
              <span>You are on the latest version of MeetMind.</span>
            </div>
          )}

          {/* Update Error Notice */}
          {updaterState?.status === 'error' && updaterState?.errorMessage && (
            <div className="p-3 rounded-lg bg-rose-950/30 border border-rose-800/40 flex items-center gap-2.5 text-xs text-rose-300">
              <AlertCircle size={15} className="text-rose-400 flex-shrink-0" />
              <span className="truncate">{updaterState.errorMessage}</span>
            </div>
          )}

          {/* Auto check toggle */}
          <label className="flex items-center justify-between cursor-pointer pt-1">
            <div>
              <p className="text-sm font-medium">Automatic update checks</p>
              <p className="text-[#555] text-xs">Check for new releases in the background</p>
            </div>
            <div
              className={`w-10 h-6 rounded-full transition-colors relative ${form.autoCheckUpdates !== false ? 'bg-green-600' : 'bg-[#333]'}`}
              onClick={() => setForm((p) => ({ ...p, autoCheckUpdates: p.autoCheckUpdates === false ? true : false }))}
            >
              <div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-all ${form.autoCheckUpdates !== false ? 'left-5' : 'left-1'}`} />
            </div>
          </label>
        </section>

        {/* ── Save ─────────────────────────────────────────────── */}
        <div className="flex justify-end pb-4">
          <button onClick={handleSave} className="btn-primary">
            {saved ? (
              <>
                <Check size={14} strokeWidth={2.5} />
                Saved
              </>
            ) : 'Save Settings'}
          </button>
        </div>
      </div>
    </div>
  );
}
