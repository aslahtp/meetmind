import React from 'react';
import ProviderSection from './providers/ProviderSection.jsx';

export default function TranscriptionSection({ form, onChange }) {
  return <ProviderSection kind="stt" form={form} onChange={onChange} />;
}
