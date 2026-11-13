import React from 'react';
import ProviderSection from './providers/ProviderSection';

export default function TranscriptionSection({ form, onChange }: { form?: any; onChange?: any }) {
  return <ProviderSection kind="stt" form={form} onChange={onChange} />;
}
