import React, { useState, useEffect } from 'react';
import { useApp } from '../app.jsx';

function Field({ label, hint, children }) {
  return (
    <div className="space-y-1.5">
      <label className="text-sm font-medium text-[#d0d0d0]">{label}</label>
      {children}
      {hint && <p className="text-xs text-[#555]">{hint}</p>}
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
        className="input pr-10"
      />
      <button
        type="button"
        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#555] hover:text-[#888]"
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
    <div className="flex items-center gap-2">
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
            Testing…
          </>
        ) : 'Test Connection'}
      </button>
      {status === 'ok' && (
        <span className="text-green-500 text-xs flex items-center gap-1">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <polyline points="20 6 9 17 4 12"/>
          </svg>
          Connected
        </span>
      )}
      {status === 'error' && (
        <span className="text-red-400 text-xs">{error}</span>
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
    googleApiKey:      '',
    geminiApiKey:      '',
    notionToken:       '',
    notionDatabaseId:  '',
    selectedModel:     'gemini-1.5-flash',
    systemAudioDevice: '',
    micDevice:         '',
    autoLaunch:        true,
  });
  const [models, setModels] = useState([]);
  const [devices, setDevices] = useState({ all: [], system: null, mic: null });
  const [loadingDevices, setLoadingDevices] = useState(false);
  const [saved, setSaved] = useState(false);
  const [activeOnboardingStep, setActiveOnboardingStep] = useState(null);

  useEffect(() => {
    if (config) {
      setForm({
        googleApiKey:      config.googleApiKey      || '',
        geminiApiKey:      config.geminiApiKey      || '',
        notionToken:       config.notionToken       || '',
        notionDatabaseId:  config.notionDatabaseId  || '',
        selectedModel:     config.selectedModel     || 'gemini-1.5-flash',
        systemAudioDevice: config.systemAudioDevice || '',
        micDevice:         config.micDevice         || '',
        autoLaunch:        config.autoLaunch !== false,
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

  const loadDevices = async () => {
    setLoadingDevices(true);
    try {
      const d = await window.meetmind.recording.listDevices();
      setDevices(d);
      if (d.system && !form.systemAudioDevice) setForm((p) => ({ ...p, systemAudioDevice: d.system }));
      if (d.mic    && !form.micDevice)          setForm((p) => ({ ...p, micDevice: d.mic }));
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
                    <span className="text-sm font-medium">{step.title}</span>
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
                  <div className="px-4 pb-4 bg-[#1d1d1d]">
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
            label="Google Cloud API Key"
            hint="Used for Speech-to-Text transcription"
          >
            <PasswordInput
              value={form.googleApiKey}
              onChange={update('googleApiKey')}
              placeholder="AIzaSy…"
            />
            <TestButton
              onTest={async () => {
                const r = await window.meetmind.api.testGoogle(form.googleApiKey);
                if (!r.success) throw new Error(r.error);
              }}
            />
          </Field>

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
                const r = await window.meetmind.api.testGemini(form.geminiApiKey);
                if (!r.success) throw new Error(r.error);
              }}
            />
          </Field>

          <Field
            label="Notion Integration Token"
            hint='Format: secret_xxx — from notion.so/my-integrations'
          >
            <PasswordInput
              value={form.notionToken}
              onChange={update('notionToken')}
              placeholder="secret_…"
            />
          </Field>

          <Field
            label="Notion Database ID"
            hint="Found in your database URL: notion.so/workspace/{ID}?v=…"
          >
            <input
              type="text"
              value={form.notionDatabaseId}
              onChange={update('notionDatabaseId')}
              placeholder="32-character ID…"
              className="input"
            />
            <TestButton
              onTest={async () => {
                const r = await window.meetmind.notion.testConnection(form.notionToken, form.notionDatabaseId);
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
              className="input"
            >
              {models.map((m) => (
                <option key={m.id} value={m.id}>{m.label}</option>
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

          <div className="p-3 bg-[#1d1d1d] border border-[#2a2a2a] rounded-lg text-xs text-[#666] space-y-1">
            <p><strong className="text-[#888]">System Audio:</strong> Requires "Stereo Mix" enabled in Windows Sound settings.</p>
            <p>Right-click speaker → Sound → Recording tab → right-click empty area → Show Disabled Devices → Enable Stereo Mix</p>
          </div>

          <Field label="System Audio Device (loopback)">
            <select
              value={form.systemAudioDevice}
              onChange={update('systemAudioDevice')}
              className="input"
            >
              <option value="">— Select or detect devices —</option>
              {devices.all?.map((d) => (
                <option key={d} value={d}>{d}</option>
              ))}
              {form.systemAudioDevice && !devices.all?.includes(form.systemAudioDevice) && (
                <option value={form.systemAudioDevice}>{form.systemAudioDevice}</option>
              )}
            </select>
          </Field>

          <Field label="Microphone Device">
            <select
              value={form.micDevice}
              onChange={update('micDevice')}
              className="input"
            >
              <option value="">— Select or detect devices —</option>
              {devices.all?.map((d) => (
                <option key={d} value={d}>{d}</option>
              ))}
              {form.micDevice && !devices.all?.includes(form.micDevice) && (
                <option value={form.micDevice}>{form.micDevice}</option>
              )}
            </select>
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
