import React, { useState, useEffect } from 'react';
import { useApp } from '../app.jsx';
import NotionIcon from './NotionIcon.jsx';

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
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
            <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
            <line x1="1" y1="1" x2="23" y2="23"/>
          </svg>
        ) : (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>
          </svg>
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
            <svg className="spinner w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
            </svg>
            Testing Connection…
          </>
        ) : 'Test Connection'}
      </button>
      {status === 'ok' && (
        <span className="text-emerald-400 text-xs font-semibold flex items-center gap-1">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <polyline points="20 6 9 17 4 12"/>
          </svg>
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
            <svg className="spinner w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
            </svg>
            Probing Audio (3s)…
          </>
        ) : 'Probe Level'}
      </button>
      {result && !probing && (
        result.isSilent ? (
          <span className="text-rose-400 text-xs flex items-center gap-1">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>
            </svg>
            Silent (peak {result.peak ?? 0}) — check levels &amp; privacy
          </span>
        ) : (
          <span className="text-emerald-400 text-xs font-semibold flex items-center gap-1">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <polyline points="20 6 9 17 4 12"/>
            </svg>
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
  });
  const [models, setModels] = useState([]);
  const [devices, setDevices] = useState({ all: [], system: null, mic: null });
  const [loadingDevices, setLoadingDevices] = useState(false);
  const [probeResults, setProbeResults] = useState({});
  const [probingDevice, setProbingDevice] = useState(null);
  const [saved, setSaved] = useState(false);
  const [activeOnboardingStep, setActiveOnboardingStep] = useState(null);

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
      });
    }
  }, [config]);

  useEffect(() => {
    window.meetmind?.models.list().then(setModels);
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

  const handleSave = async () => {
    await window.meetmind.config.setMultiple(form);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
    onSave?.(form);
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-2xl mx-auto px-6 py-6 space-y-8">
        <div>
          <h1 className="text-lg font-semibold">Settings</h1>
          <p className="text-[#666] text-sm mt-1">Configure your API keys and preferences</p>
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
                      {step.id === 'notion' && <NotionIcon size={16} />}
                      {step.title}
                    </span>
                    <span className="text-[#555] text-xs ml-2">{step.description}</span>
                  </div>
                  <svg
                    className={`w-4 h-4 text-[#555] flex-shrink-0 transition-transform ${activeOnboardingStep === step.id ? 'rotate-180' : ''}`}
                    viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                  >
                    <polyline points="6 9 12 15 18 9"/>
                  </svg>
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
                      className="text-green-500 text-xs hover:underline"
                      target="_blank" rel="noreferrer"
                    >
                      Open {step.title} ↗
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
                <p className="text-sm font-medium text-[#d0d0d0]">Google Speech-to-Text settings</p>
                <p className="text-xs text-[#aaa]">
                  Uses Google Cloud Speech-to-Text with support for long meetings and English/Malayalam recognition.
                  Configure API key, project, and optional GCS bucket for BatchRecognize.
                </p>
              </div>

              <Field
                label="Google Cloud API Key"
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
                label="Google Cloud Project ID"
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
                label="GCS bucket (optional)"
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
                label="Service account key path (optional)"
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
                <p className="text-sm font-medium text-[#d0d0d0]">Sarvam AI settings</p>
                <p className="text-xs text-[#aaa]">
                  Uses Sarvam&apos;s saaras:v3 model in codemix mode with automatic language detection.
                  Works well for meetings that mix Malayalam and English — English stays in Latin script,
                  Indic languages in their native script. Speaker diarization is enabled.
                </p>
              </div>

              <Field
                label="Sarvam AI API Key"
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
                  <p className="text-sm font-medium text-[#d0d0d0]">
                    AssemblyAI settings
                    <span className="ml-2 inline-flex items-center rounded-full border border-yellow-500/60 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-yellow-400/90">
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
                label="AssemblyAI API Key"
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
                label="AssemblyAI Prompt (optional)"
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
            label="Gemini API Key"
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
          <Field label="Gemini Model" hint="Flash is faster; Pro gives the most detailed notes">
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
                  <svg className="spinner w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
                  </svg>
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

        {/* ── Save ─────────────────────────────────────────────── */}
        <div className="flex justify-end pb-4">
          <button onClick={handleSave} className="btn-primary">
            {saved ? (
              <>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <polyline points="20 6 9 17 4 12"/>
                </svg>
                Saved
              </>
            ) : 'Save Settings'}
          </button>
        </div>
      </div>
    </div>
  );
}
