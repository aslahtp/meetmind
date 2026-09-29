import React from 'react';
import { TextField } from '../../ui/index.jsx';
import { RadioCardGroup } from '../SettingsParts.jsx';

/**
 * Model picker for a provider: curated cards plus, when the provider allows it,
 * a free-text field for any other model ID. A saved ID outside the curated list
 * shows up in the text field with no card selected.
 */
export default function ModelSelect({ idPrefix, label, provider, value, onChange }) {
  const curated = provider.models.some((m) => m.id === value);
  const custom = curated ? '' : value || '';

  return (
    <div className="space-y-16">
      <RadioCardGroup
        label={label}
        options={provider.models}
        value={curated ? value : undefined}
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
      {provider.allowCustomModel && (
        <TextField
          id={`${idPrefix}-custom-model`}
          label="Custom model ID (optional)"
          hint={`Use a model that isn't listed above. Clear the field or pick a card to go back to the curated list.`}
          value={custom}
          onChange={(e) => onChange(e.target.value.trim() || provider.defaultModel)}
          placeholder={provider.defaultModel}
        />
      )}
    </div>
  );
}
