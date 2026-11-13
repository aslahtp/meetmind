import React, { useEffect, useState } from 'react';
import { Braces, FileText, RotateCcw, FolderOpen, MessageSquareText, FileDown, type LucideIcon } from 'lucide-react';
import { SegmentedControl, Switch } from '../ui/index';
import { SettingsGroup, SettingRow } from './SettingsParts';
import ProviderSection from './providers/ProviderSection';
import type { FormChange, SettingsForm } from './types';

const OUTPUT_MODES: { value: OutputMode; label: string; icon: LucideIcon }[] = [
  { value: 'json', label: 'JSON (structured)', icon: Braces },
  { value: 'markdown', label: 'Markdown', icon: FileText },
];

const OUTPUT_MODE_HELP: Record<OutputMode, string> = {
  json: 'Structured notes with a discrete summary, key topics, decisions and action items. Best for Notion databases.',
  markdown: 'Executive meeting minutes in Markdown with headings, bullet points and an action items table. Best for Notion pages.',
};

type OutputMode = 'json' | 'markdown';

interface NotesSectionProps {
  form: SettingsForm;
  onChange: FormChange;
  defaultSystemPrompt: string;
  defaultMdSystemPrompt: string;
}

export default function NotesSection({ form, onChange, defaultSystemPrompt, defaultMdSystemPrompt }: NotesSectionProps) {
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
    if (res && 'path' in res && res.path) onChange('pdfExportDir', res.path);
  };

  const outputMode: OutputMode = (form.promptOutputMode || form.noteOutputMode) === 'markdown' ? 'markdown' : 'json';
  const hasCustomPrompt = !!(form.systemPrompt && form.systemPrompt.trim() !== '');

  const setOutputMode = (mode: OutputMode) => {
    onChange('promptOutputMode', mode);
    onChange('noteOutputMode', mode);
  };

  const setPrompt = (value: string) => {
    onChange('systemPrompt', value);
    onChange('geminiSystemPrompt', value);
  };

  return (
    <div className="space-y-24">
      <ProviderSection kind="llm" form={form} onChange={onChange} />

      <SettingsGroup
        title="Output & system prompt"
        description="The format and instructions sent to the model when generating notes."
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
            onChange={(v: boolean) => onChange('pdfIncludeTranscript', v)}
          />
        </SettingRow>
      </SettingsGroup>
    </div>
  );
}
