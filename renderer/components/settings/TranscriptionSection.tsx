import React from 'react';
import ProviderSection from './providers/ProviderSection';
import type { FormChange, SettingsForm } from './types';

interface TranscriptionSectionProps {
  form: SettingsForm;
  onChange: FormChange;
}

export default function TranscriptionSection({ form, onChange }: TranscriptionSectionProps) {
  return <ProviderSection kind="stt" form={form} onChange={onChange} />;
}
