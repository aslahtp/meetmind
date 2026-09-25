import React, { useEffect, useState } from 'react';
import { Braces, FileText, RotateCcw, FolderOpen, BrainCircuit, MessageSquareText, FileDown } from 'lucide-react';
import GeminiIcon from '../GeminiIcon.jsx';
import { PasswordField, SegmentedControl, Switch } from '../ui/index.jsx';
import { SettingsGroup, SettingRow, KeyGuide, TestAction, RadioCardGroup, ExternalLink } from './SettingsParts.jsx';
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
  const [downloadsDir, setDownloadsDir] = useState('');

  // The default PDF folder is the Windows Downloads folder; shown when no custom folder is set.
  useEffect(() => {
    window.meetmind?.pdf?.defaultDir?.().then((dir) => setDownloadsDir(dir || '')).catch(() => {});
  }, []);

  const handleChoosePdfDir = async () => {
    const res = await window.meetmind?.dialog?.chooseFolder?.({
      title: 'Choose where to save PDFs',
      defaultPath: form.pdfExportDir || downloadsDir || undefined,
    });
    if (res?.path) onChange('pdfExportDir', res.path);
  };

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
        icon={<GeminiIcon size={20} />}
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

      <SettingsGroup
        title="Model"
        description="The primary model used to write notes."
        icon={<BrainCircuit size={20} strokeWidth={1.75} className="text-ink" />}
      >
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
        icon={<MessageSquareText size={20} strokeWidth={1.75} className="text-ink" />}
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

      <SettingsGroup
        title="PDF export"
        description="Where Export PDF on a meeting saves its notes, and what goes in the file."
        icon={<FileDown size={20} strokeWidth={1.75} className="text-ink" />}
      >
        <div>
          <label htmlFor="pdf-export-dir" className="label">Save to</label>
          <div className="flex items-center gap-8">
            <input
              id="pdf-export-dir"
              type="text"
              readOnly
              value={form.pdfExportDir || downloadsDir}
              title={form.pdfExportDir || downloadsDir}
              placeholder="Downloads"
              className="input flex-1 min-w-0 text-caption"
            />
            <button type="button" onClick={handleChoosePdfDir} className="btn-ghost btn-sm flex-shrink-0">
              <FolderOpen size={14} strokeWidth={1.75} />
              Browse…
            </button>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-16 mt-8">
            <span className="hint">
              {form.pdfExportDir ? 'Custom folder' : 'Your Downloads folder (default)'}
              {' · Files are named date-time-title, e.g. 2026-09-25-1430-Weekly-standup.pdf'}
            </span>
            {form.pdfExportDir && (
              <button type="button" onClick={() => onChange('pdfExportDir', '')} className="btn-quiet btn-sm">
                <RotateCcw size={14} strokeWidth={1.75} />
                Use Downloads
              </button>
            )}
          </div>
        </div>

        <SettingRow
          label="Include transcript"
          description="Add the full speaker-labelled transcript, with timestamps, after the notes."
          htmlFor="pdf-include-transcript"
        >
          <Switch
            id="pdf-include-transcript"
            label="Include transcript in PDF"
            checked={!!form.pdfIncludeTranscript}
            onChange={(v) => onChange('pdfIncludeTranscript', v)}
          />
        </SettingRow>
      </SettingsGroup>
    </div>
  );
}
