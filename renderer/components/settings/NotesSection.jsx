import React, { useState } from 'react';
import { Braces, FileText, RotateCcw } from 'lucide-react';
import { PasswordField, SegmentedControl } from '../ui/index.jsx';
import { SettingsGroup, KeyGuide, TestAction, RadioCardGroup, ExternalLink } from './SettingsParts.jsx';
import { GEMINI_MODELS } from './data.js';

const OUTPUT_MODES = [
  { value: 'json', label: 'JSON (structured)', icon: Braces },
  { value: 'markdown', label: 'Markdown', icon: FileText },
];

const OUTPUT_MODE_HELP = {
  json: 'Structured notes with a discrete summary, key topics, decisions and action items. Best for Notion databases.',
  markdown: 'Executive meeting minutes in Markdown with headings, bullet points and an action items table. Best for Notion pages.',
};

export default function NotesSection({ form, onChange, defaultSystemPrompt, defaultMdSystemPrompt }) {
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState(null);

  const outputMode = (form.promptOutputMode || form.noteOutputMode) === 'markdown' ? 'markdown' : 'json';
  const hasCustomPrompt = !!(form.systemPrompt && form.systemPrompt.trim() !== '');

  const handleTest = async () => {
    setTesting(true);
    setResult(null);
    try {
      const res = await window.meetmind.api.testGemini(form.geminiApiKey, form.geminiModel);
      setResult(res);
    } catch (err) {
      setResult({ success: false, error: err.message });
    } finally {
      setTesting(false);
    }
  };

  const setOutputMode = (mode) => {
    onChange('promptOutputMode', mode);
    onChange('noteOutputMode', mode);
  };

  const setPrompt = (value) => {
    onChange('systemPrompt', value);
    onChange('geminiSystemPrompt', value);
  };

  return (
    <div className="space-y-24">
      <SettingsGroup
        title="Gemini API key"
        description="Gemini turns transcripts into structured meeting notes."
        aside={<ExternalLink href="https://aistudio.google.com/app/apikey">Get API key</ExternalLink>}
      >
        <div className="space-y-16">
          <PasswordField
            id="gemini-key"
            label="Google Gemini API key"
            value={form.geminiApiKey || ''}
            onChange={(e) => onChange('geminiApiKey', e.target.value)}
            placeholder="AIzaSy..."
          />
          <KeyGuide provider="google" />
        </div>
      </SettingsGroup>

      <SettingsGroup title="Model" description="The primary model used to write notes.">
        <RadioCardGroup
          label="Gemini model"
          options={GEMINI_MODELS}
          value={form.geminiModel}
          onChange={(id) => { onChange('geminiModel', id); setResult(null); }}
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

        <div>
          <label htmlFor="secondary-gemini-model" className="label">Fallback model</label>
          <select
            id="secondary-gemini-model"
            value={form.secondaryGeminiModel || ''}
            onChange={(e) => onChange('secondaryGeminiModel', e.target.value)}
            aria-describedby="secondary-gemini-model-hint"
            className="input"
          >
            <option value="">None (disabled)</option>
            {GEMINI_MODELS.filter((m) => m.id !== form.geminiModel).map((model) => (
              <option key={model.id} value={model.id}>
                {model.name} — {model.badge}
              </option>
            ))}
          </select>
          <p id="secondary-gemini-model-hint" className="hint mt-8">
            If the primary model fails (for example a rate limit or outage), MeetMind retries automatically with this model.
          </p>
        </div>

        <TestAction
          onClick={handleTest}
          testing={testing}
          label="Test Gemini connection"
          result={result}
          successLabel="Gemini verified"
        />
      </SettingsGroup>

      <SettingsGroup
        title="Output & system prompt"
        description="The format and instructions sent to Gemini when generating notes."
      >
        <div>
          <p className="label">Output format</p>
          <SegmentedControl
            role="radiogroup"
            label="Output format"
            options={OUTPUT_MODES}
            value={outputMode}
            onChange={setOutputMode}
          />
          <p className="hint mt-8">{OUTPUT_MODE_HELP[outputMode]}</p>
        </div>

        <div>
          <label htmlFor="system-prompt" className="label">System prompt</label>
          <textarea
            id="system-prompt"
            value={form.systemPrompt ? form.systemPrompt : (outputMode === 'markdown' ? defaultMdSystemPrompt : defaultSystemPrompt)}
            onChange={(e) => setPrompt(e.target.value)}
            rows={10}
            placeholder="Enter custom instructions for meeting notes generation…"
            className="input resize-y text-caption"
          />
          <div className="flex flex-wrap items-center justify-between gap-16 mt-8">
            <span className="hint">
              {hasCustomPrompt ? 'Custom prompt active' : 'Using the default system prompt'}
            </span>
            {hasCustomPrompt && (
              <button type="button" onClick={() => setPrompt('')} className="btn-quiet btn-sm">
                <RotateCcw size={14} strokeWidth={1.75} />
                Reset to default
              </button>
            )}
          </div>
        </div>
      </SettingsGroup>
    </div>
  );
}
