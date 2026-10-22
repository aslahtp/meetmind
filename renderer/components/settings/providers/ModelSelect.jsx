import React, { useEffect, useState } from 'react';
import { TextField, SegmentedControl } from '../../ui/index.jsx';
import { RadioCardGroup } from '../SettingsParts.jsx';

const MODE_HINTS = {
  pinned: 'A fixed model version. Notes stay consistent until you pick another one.',
  latest: 'Always the newest model in the family. Google can swap the model behind it, with two weeks\' notice for breaking changes, so notes may change without a MeetMind update.',
  custom: 'Any model ID the provider accepts, for a model that isn\'t listed.',
};

/** Which picker a saved model ID belongs to. */
export function modelMode(provider, value) {
  if (provider.latestModels?.some((m) => m.id === value)) return 'latest';
  if (!value || provider.models.some((m) => m.id === value)) return 'pinned';
  return provider.allowCustomModel ? 'custom' : 'pinned';
}

function ModelCards({ label, models, value, onChange }) {
  return (
    <RadioCardGroup
      label={label}
      options={models}
      value={models.some((m) => m.id === value) ? value : undefined}
      onChange={onChange}
      className="grid grid-cols-1 md:grid-cols-2 gap-16"
      renderOption={(model) => (
        <span className="block">
          <span className="flex flex-wrap items-center gap-8">
            <span className="text-body-sm font-medium text-ink">{model.name}</span>
            <span className="pill-quiet">{model.badge}</span>
          </span>
          <span className="block text-caption text-graphite mt-8">{model.description}</span>
        </span>
      )}
    />
  );
}

/**
 * Model picker for a provider: curated cards plus, when the provider allows it,
 * a free-text field for any other model ID. A saved ID outside the curated list
 * shows up in the text field with no card selected.
 *
 * Providers with `latestModels` (auto-updating aliases such as `gemini-flash-latest`)
 * get a Latest / Pinned / Custom toggle instead, showing one picker at a time.
 */
export default function ModelSelect({ idPrefix, label, provider, value, onChange }) {
  const hasLatest = provider.latestModels?.length > 0;
  const [mode, setMode] = useState(() => modelMode(provider, value));
  const savedMode = modelMode(provider, value);

  // Follow outside changes (Discard, a cleared custom field); an empty Custom field keeps its tab.
  useEffect(() => {
    if (savedMode !== 'pinned' || mode !== 'custom') setMode(savedMode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const custom = savedMode === 'custom' ? value : '';
  const customField = provider.allowCustomModel && (
    <TextField
      id={`${idPrefix}-custom-model`}
      label={hasLatest ? 'Model ID' : 'Custom model ID (optional)'}
      hint={hasLatest
        ? `Clear the field to go back to ${provider.defaultModel}.`
        : 'Use a model that isn\'t listed above. Clear the field or pick a card to go back to the curated list.'}
      value={custom}
      onChange={(e) => onChange(e.target.value.trim() || provider.defaultModel)}
      placeholder={provider.defaultModel}
    />
  );

  if (!hasLatest) {
    return (
      <div className="space-y-16">
        <ModelCards label={label} models={provider.models} value={value} onChange={onChange} />
        {customField}
      </div>
    );
  }

  const modes = [
    { value: 'latest', label: 'Latest' },
    { value: 'pinned', label: 'Pinned' },
    ...(provider.allowCustomModel ? [{ value: 'custom', label: 'Custom' }] : []),
  ];

  const switchMode = (next) => {
    setMode(next);
    if (next === 'pinned' && savedMode !== 'pinned') onChange(provider.defaultModel);
    if (next === 'latest' && savedMode !== 'latest') onChange(provider.latestModels[0].id);
  };

  return (
    <div className="space-y-16">
      <div className="space-y-8">
        <SegmentedControl
          label={`${label} type`}
          role="radiogroup"
          size="sm"
          options={modes}
          value={mode}
          onChange={switchMode}
        />
        <p className="hint">{MODE_HINTS[mode]}</p>
      </div>
      {mode === 'pinned' && <ModelCards label={label} models={provider.models} value={value} onChange={onChange} />}
      {mode === 'latest' && <ModelCards label={label} models={provider.latestModels} value={value} onChange={onChange} />}
      {mode === 'custom' && customField}
    </div>
  );
}
