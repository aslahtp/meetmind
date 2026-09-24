import React, { useState } from 'react';
import { PasswordField, TextField, StatusDot, AvatarTile } from '../ui/index.jsx';
import { SettingsGroup, KeyGuide, TestAction, RadioCardGroup, ExternalLink } from './SettingsParts.jsx';
import { STT_SERVICES } from './data.js';

const PROVIDER_FIELDS = {
  google: {
    key: 'googleApiKey',
    label: 'Google Cloud STT API key',
    placeholder: 'AIzaSy...',
    hint: 'You can use the same Google AI Studio / Gemini API key for Google STT.',
    link: { href: 'https://aistudio.google.com/app/apikey', label: 'Get API key' },
  },
  sarvam: {
    key: 'sarvamApiKey',
    label: 'Sarvam AI API key',
    placeholder: 'sarvam_api_key_...',
    hint: 'High accuracy transcription for Indian languages, including Malayalam with seamless code-switching.',
    link: { href: 'https://dashboard.sarvam.ai', label: 'Sarvam dashboard' },
  },
  assemblyai: {
    key: 'assemblyAiApiKey',
    label: 'AssemblyAI API key',
    placeholder: 'assemblyai_key_...',
    link: { href: 'https://www.assemblyai.com/dashboard', label: 'AssemblyAI dashboard' },
  },
};

export default function TranscriptionSection({ form, onChange }) {
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState(null);

  const service = form.sttService || 'google';
  const field = PROVIDER_FIELDS[service] || PROVIDER_FIELDS.google;
  const serviceInfo = STT_SERVICES.find((s) => s.id === service) || STT_SERVICES[0];

  const handleTest = async () => {
    setTesting(true);
    setResult(null);
    try {
      let res;
      if (service === 'google') {
        res = await window.meetmind.api.testGoogle(form.googleApiKey);
      } else if (service === 'sarvam') {
        res = await window.meetmind.api.testSarvam(form.sarvamApiKey);
      } else {
        res = await window.meetmind.api.testAssemblyAi(form.assemblyAiApiKey);
      }
      setResult(res);
    } catch (err) {
      setResult({ success: false, error: err.message });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="space-y-24">
      <SettingsGroup
        title="Speech-to-text engine"
        description="Choose which service transcribes your recordings."
      >
        <RadioCardGroup
          label="Speech-to-text engine"
          options={STT_SERVICES}
          value={service}
          onChange={(id) => { onChange('sttService', id); setResult(null); }}
          className="space-y-16"
          renderOption={(svc) => {
            const Icon = svc.icon;
            const hasKey = !!form[svc.requiresKey]?.trim();
            return (
              <span className="flex items-start gap-16">
                <AvatarTile size={40}>
                  <Icon size={20} />
                </AvatarTile>
                <span className="flex-1 min-w-0 block">
                  <span className="flex flex-wrap items-center gap-8">
                    <span className="text-body-sm font-medium text-ink">{svc.name}</span>
                    <span className="pill-quiet">{svc.badge}</span>
                    <span className="pill">
                      <StatusDot tone={hasKey ? 'ok' : 'neutral'} />
                      {hasKey ? 'Key set' : 'No key'}
                    </span>
                  </span>
                  <span className="block text-caption text-graphite mt-8">{svc.description}</span>
                  <span className="block text-caption text-graphite mt-4">{svc.pricing}</span>
                </span>
              </span>
            );
          }}
        />
      </SettingsGroup>

      <SettingsGroup
        title={`${serviceInfo.name} credentials`}
        aside={<ExternalLink href={field.link.href}>{field.link.label}</ExternalLink>}
      >
        <div className="space-y-16">
          <PasswordField
            id={`stt-key-${service}`}
            label={field.label}
            hint={field.hint}
            value={form[field.key] || ''}
            onChange={(e) => onChange(field.key, e.target.value)}
            placeholder={field.placeholder}
          />
          <KeyGuide provider={service} />
        </div>

        {service === 'assemblyai' && (
          <TextField
            id="assemblyai-prompt"
            label="Transcription guidance / key terms (optional)"
            hint="Custom domain terms, names, or languages that improve recognition accuracy."
            value={form.assemblyAiPrompt || ''}
            onChange={(e) => onChange('assemblyAiPrompt', e.target.value)}
            placeholder="e.g. Malayalam, Kubernetes, MeetMind, API tokens…"
          />
        )}

        <TestAction
          onClick={handleTest}
          testing={testing}
          label="Test connection"
          result={result}
          successLabel="Connection verified"
        />
      </SettingsGroup>
    </div>
  );
}
