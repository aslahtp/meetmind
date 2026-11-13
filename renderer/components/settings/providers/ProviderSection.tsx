import React, { useState } from 'react';
import { AudioWaveform, BrainCircuit, LifeBuoy } from 'lucide-react';
import { PasswordField, TextField, StatusDot, AvatarTile } from '../../ui/index';
import { SettingsGroup, KeyGuide, TestAction, RadioCardGroup, ExternalLink } from '../SettingsParts';
import { useApp } from '../../../lib/app-context';
import { isProviderConfigured, findProvider, selectedProvider } from '../../../lib/providers';
import { providerIcon } from './providerIcons';
import ModelSelect, { modelMode } from './ModelSelect';

// Per-kind wording and the config keys that hold the choice. Everything else comes from the
// provider descriptors, so a new provider needs no change here.
const KINDS = {
  stt: {
    pickerTitle: 'Speech-to-text engine',
    pickerDescription: 'Choose which service transcribes your recordings.',
    pickerIcon: AudioWaveform,
    providerKey: 'sttService',
    modelsKey: 'sttModels',
    modelTitle: 'Transcription model',
    modelDescription: 'The model this engine uses to transcribe.',
  },
  llm: {
    pickerTitle: 'Note generation provider',
    pickerDescription: 'Choose which AI turns transcripts into meeting notes.',
    pickerIcon: BrainCircuit,
    providerKey: 'llmProvider',
    modelsKey: 'llmModels',
    modelTitle: 'Model',
    modelDescription: 'The primary model used to write notes.',
  },
};

function CredentialFields({ kind, provider, form, onChange }: { kind?: any; provider?: any; form?: any; onChange?: any }) {
  return provider.credentials.map((field: any) => {
    const Field = field.type === 'password' ? PasswordField : TextField;
    return (
      <Field
        key={field.configKey}
        id={`${kind}-${provider.id}-${field.configKey}`}
        label={field.label}
        hint={field.hint}
        value={form[field.configKey] || ''}
        onChange={(e: any) => onChange(field.configKey, e.target.value)}
        placeholder={field.placeholder}
      />
    );
  });
}

/** Cross-provider fallback: optional provider + model tried when the primary fails. */
function FallbackPicker({ providers, form, onChange }: { providers?: any; form?: any; onChange?: any }) {
  const fb = form.llmFallback || {};
  const fbProvider = findProvider(providers, 'llm', fb.provider);

  const setFallbackProvider = (id: any) => {
    const p = findProvider(providers, 'llm', id);
    onChange('llmFallback', p ? { provider: p.id, model: p.defaultModel } : {});
  };

  return (
    <SettingsGroup
      title="Fallback"
      description="If the primary model fails (for example a rate limit or outage), MeetMind retries automatically with this one."
      icon={<LifeBuoy size={20} strokeWidth={1.75} className="text-ink" />}
    >
      <div className="grid grid-cols-1 md:grid-cols-2 gap-16">
        <div>
          <label htmlFor="llm-fallback-provider" className="label">Fallback provider</label>
          <select
            id="llm-fallback-provider"
            value={fbProvider?.id || ''}
            onChange={(e) => setFallbackProvider(e.target.value)}
            className="input"
          >
            <option value="">None (disabled)</option>
            {providers.llm.map((p: any) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>

        {fbProvider && (
          <div>
            <label htmlFor="llm-fallback-model" className="label">Fallback model</label>
            <select
              id="llm-fallback-model"
              value={fb.model || fbProvider.defaultModel}
              onChange={(e) => onChange('llmFallback', { provider: fbProvider.id, model: e.target.value })}
              className="input"
            >
              {fbProvider.latestModels?.length > 0 ? (
                <>
                  <optgroup label="Pinned">
                    {fbProvider.models.map((m: any) => (
                      <option key={m.id} value={m.id}>{m.name} — {m.badge}</option>
                    ))}
                  </optgroup>
                  <optgroup label="Latest (auto-updating)">
                    {fbProvider.latestModels.map((m: any) => (
                      <option key={m.id} value={m.id}>{m.name}</option>
                    ))}
                  </optgroup>
                </>
              ) : fbProvider.models.map((m: any) => (
                <option key={m.id} value={m.id}>{m.name} — {m.badge}</option>
              ))}
              {fb.model && modelMode(fbProvider, fb.model) === 'custom' && (
                <option value={fb.model}>{fb.model} (custom)</option>
              )}
            </select>
          </div>
        )}
      </div>
      {fbProvider && !isProviderConfigured(fbProvider, form) && (
        <p className="hint" role="status">
          {fbProvider.name} has no API key yet, so the fallback is skipped until you add one in its own settings.
        </p>
      )}
    </SettingsGroup>
  );
}

/**
 * Generic settings for one provider kind: engine picker, credentials, model and connection test.
 * `kind` is 'stt' or 'llm'; the descriptors come from the main process via the app context.
 */
export default function ProviderSection({ kind, form, onChange }: { kind?: any; form?: any; onChange?: any }) {
  const { providers } = useApp();
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<any>(null);

  const k = (KINDS as any)[kind];
  if (!providers) return null;

  const options = providers[kind];
  const provider = selectedProvider(providers, kind, form);
  const models = form[k.modelsKey] || {};
  const model = models[provider.id] || provider.defaultModel;
  const PickerIcon = k.pickerIcon;
  const ProviderIcon = providerIcon(provider.icon);
  const link = provider.credentials.find((f: any) => f.link)?.link;

  const setModel = (id: any) => {
    onChange(k.modelsKey, { ...models, [provider.id]: id });
    setResult(null);
  };

  const handleTest = async () => {
    setTesting(true);
    setResult(null);
    try {
      const values = {};
      for (const f of provider.credentials) (values as any)[f.configKey] = form[f.configKey] || '';
      setResult(await window.meetmind.providers.test({ kind, id: provider.id, values, model }));
    } catch (err: any) {
      setResult({ success: false, error: err.message });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="space-y-24">
      <SettingsGroup
        title={k.pickerTitle}
        description={k.pickerDescription}
        icon={<PickerIcon size={20} strokeWidth={1.75} className="text-ink" />}
      >
        <RadioCardGroup
          label={k.pickerTitle}
          options={options}
          value={provider.id}
          onChange={(id: any) => { onChange(k.providerKey, id); setResult(null); }}
          className="space-y-16"
          renderOption={(p: any) => {
            const Icon = providerIcon(p.icon);
            const hasKey = isProviderConfigured(p, form);
            return (
              <span className="flex items-start gap-16">
                <AvatarTile size={40}>
                  <Icon size={20} />
                </AvatarTile>
                <span className="flex-1 min-w-0 block">
                  <span className="flex flex-wrap items-center gap-8">
                    <span className="text-body-sm font-medium text-ink">{p.name}</span>
                    <span className="pill-quiet">{p.badge}</span>
                    <span className="pill">
                      <StatusDot tone={hasKey ? 'ok' : 'neutral'} />
                      {hasKey ? 'Key set' : 'No key'}
                    </span>
                  </span>
                  <span className="block text-caption text-graphite mt-8">{p.description}</span>
                  <span className="block text-caption text-graphite mt-4">{p.pricing}</span>
                </span>
              </span>
            );
          }}
        />
      </SettingsGroup>

      <SettingsGroup
        title={`${provider.name} credentials`}
        icon={<ProviderIcon size={20} />}
        aside={link && <ExternalLink href={link.href}>{link.label}</ExternalLink>}
      >
        <div className="space-y-16">
          <CredentialFields kind={kind} provider={provider} form={form} onChange={onChange} />
          <KeyGuide steps={provider.guide} />
        </div>
      </SettingsGroup>

      <SettingsGroup
        title={k.modelTitle}
        description={k.modelDescription}
        icon={<BrainCircuit size={20} strokeWidth={1.75} className="text-ink" />}
      >
        <ModelSelect
          key={provider.id}
          idPrefix={`${kind}-${provider.id}`}
          label={`${provider.name} model`}
          provider={provider}
          value={model}
          onChange={setModel}
          toggle={kind === 'llm'}
        />
        {provider.capabilities?.diarization === false && (
          <p className="hint">This engine does not identify speakers, so every line is labelled "Speaker 1".</p>
        )}
        <TestAction
          onClick={handleTest}
          testing={testing}
          label={`Test ${provider.name} connection`}
          result={result}
          successLabel={`${provider.name} verified`}
        />
      </SettingsGroup>

      {kind === 'llm' && <FallbackPicker providers={providers} form={form} onChange={onChange} />}
    </div>
  );
}
