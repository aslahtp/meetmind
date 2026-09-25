import React, { useState, useMemo, useRef, useEffect, useLayoutEffect, useCallback } from 'react';
import { FileText, Mic, Volume2, MicOff, Sparkles, Loader2, Eye, Code } from 'lucide-react';
import { useApp } from '../lib/app-context.js';
import TranscriptViewer from './TranscriptViewer.jsx';
import { NoteToolbar, NoteTitleBlock } from './note/NoteHeader.jsx';
import SummaryJson from './note/SummaryJson.jsx';
import AudioPlayer from './note/AudioPlayer.jsx';
import { MarkdownNoteView } from './note/markdown.jsx';
import { buildNotesMarkdown, parseNotesMarkdown, notesTitle } from './note/copyMarkdown.js';
import { EmptyState, StepBadge, ProgressBar, SaveBar, SegmentedControl } from './ui/index.jsx';
import { formatDurationSeconds } from '../lib/format.js';
import { isProcessing, PIPELINE_STAGES, STAGE_LABELS, stageIndex } from '../lib/status.js';

// ── Processing state ─────────────────────────────────────────────────────────

function ProcessingCard({ stage, percent, includeNotion, onRestart }) {
  const stages = includeNotion ? PIPELINE_STAGES : PIPELINE_STAGES.filter((s) => s.key !== 'uploading');
  const current = Math.max(0, stageIndex(stage));
  const pct = percent != null ? Math.round(percent) : null;

  return (
    <section className="card fade-in" aria-busy="true" aria-live="polite">
      <div className="flex items-center justify-between gap-16">
        <p className="eyebrow">Processing</p>
        {pct != null && <span className="text-caption text-graphite tabular">{pct}%</span>}
      </div>
      <h2 className="flex items-center gap-8 text-heading-sm font-medium text-ink mt-8">
        <Loader2 size={20} strokeWidth={1.75} className="spinner text-graphite" aria-hidden="true" />
        {STAGE_LABELS[stage] || 'Processing'}…
      </h2>
      <p className="text-body-sm text-graphite mt-8">
        You can keep using MeetMind. This page updates when the notes are ready.
      </p>
      <ol className="flex flex-wrap gap-8 mt-24">
        {stages.map((s, i) => (
          <li key={s.key} className={i > current ? 'opacity-40' : ''}>
            <StepBadge n={i + 1} done={i < current}>{s.label}</StepBadge>
          </li>
        ))}
      </ol>
      {pct != null && (
        <div className="mt-24">
          <ProgressBar value={pct} label="Processing progress" />
        </div>
      )}
      {onRestart && (
        <p className="text-caption text-graphite mt-24">
          No progress for a while?{' '}
          <button type="button" onClick={onRestart} className="font-medium text-ink underline underline-offset-4">
            Start processing again
          </button>
        </p>
      )}
    </section>
  );
}

// ── Summary tab ──────────────────────────────────────────────────────────────

function SummaryTab({ notes, title, noSpeech, isError, busy, onGenerate, onRetry }) {
  if (notes) {
    return notes._rawMarkdown
      ? <MarkdownNoteView markdown={notes._rawMarkdown} omitTitle={title} />
      : <SummaryJson notes={notes} />;
  }
  if (busy) return null;

  if (noSpeech) {
    return (
      <EmptyState
        compact
        icon={<MicOff size={24} strokeWidth={1.75} />}
        title="No speech detected"
        message="The recording was saved but contained no audible speech."
        action={
          <button type="button" onClick={onRetry} className="btn-sunshine">
            Retry processing
          </button>
        }
      />
    );
  }

  return (
    <EmptyState
      compact
      icon={<Sparkles size={24} strokeWidth={1.75} />}
      title={isError ? 'Processing failed' : 'Notes not ready yet'}
      message={
        isError
          ? 'Something went wrong while generating notes for this meeting.'
          : 'Generate an AI summary, action items and key topics from the transcript.'
      }
      action={
        <button type="button" onClick={onGenerate} className="btn-sunshine">
          Generate notes
        </button>
      }
    />
  );
}

// ── Markdown editor ──────────────────────────────────────────────────────────

const EDIT_MODES = [
  { value: 'preview', label: 'Preview', icon: Eye },
  { value: 'markdown', label: 'Markdown', icon: Code },
];

// Grows with its content so the page scrolls, not the textarea.
function MarkdownEditor({ value, onChange, structured }) {
  const ref = useRef(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Collapsing to measure would clamp the page's scroll position; keep it.
    const scroller = el.closest('.overflow-y-auto');
    const top = scroller?.scrollTop;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight + 2}px`;
    if (scroller) scroller.scrollTop = top;
  }, [value]);

  return (
    <div className="fade-in">
      <label htmlFor="notes-markdown" className="label">Notes (Markdown)</label>
      {structured && (
        <p id="notes-markdown-hint" className="hint mb-8">
          Keep the ## section headings (Participants, Action Items, Key Topics…) so the notes keep their card layout.
        </p>
      )}
      <textarea
        id="notes-markdown"
        ref={ref}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-describedby={structured ? 'notes-markdown-hint' : undefined}
        rows={12}
        className="input font-mono text-caption leading-relaxed resize-none overflow-hidden"
      />
    </div>
  );
}

// ── Main NoteViewer ──────────────────────────────────────────────────────────

export default function NoteViewer({ session, onBack, onRefresh }) {
  const { processing, trackProcessing, addToast, confirm, config, setNavGuard } = useApp();
  const [activeTab, setActiveTab] = useState('summary');
  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState(null);
  const [regenerating, setRegenerating] = useState(false);
  const [starting, setStarting] = useState(false);
  const [copied, setCopied] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [titleHidden, setTitleHidden] = useState(false);
  const [editMode, setEditMode] = useState('preview');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const scrollRef = useRef(null);
  const titleRef = useRef(null);

  // Show the title in the toolbar once the in-page title scrolls out of view.
  useEffect(() => {
    const el = titleRef.current;
    if (!el || !scrollRef.current) return undefined;
    const observer = new IntersectionObserver(
      ([entry]) => setTitleHidden(!entry.isIntersecting),
      { root: scrollRef.current, threshold: 0 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const savedNotes = session.notes;
  const rawTranscript = session.transcript;

  // ── Editing: the draft is the notes as one Markdown document ──
  const savedMarkdown = useMemo(
    () => (savedNotes ? buildNotesMarkdown(savedNotes, session) : ''),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [savedNotes, session.title],
  );
  const [draft, setDraft] = useState(savedMarkdown);
  const lastSavedRef = useRef(savedMarkdown);
  // Follow the saved notes (save, regenerate, background refresh) unless mid-edit.
  useEffect(() => {
    const previous = lastSavedRef.current;
    lastSavedRef.current = savedMarkdown;
    setDraft((d) => (d === previous ? savedMarkdown : d));
  }, [savedMarkdown]);

  const dirty = !!savedNotes && draft !== savedMarkdown;
  // Preview shows unsaved edits, parsed back into the same shape as saved notes.
  const notes = useMemo(
    () => (dirty ? parseNotesMarkdown(draft, savedNotes) : savedNotes),
    [dirty, draft, savedNotes],
  );

  const normalizedTranscript = useMemo(() => {
    if (!rawTranscript) return [];
    if (Array.isArray(rawTranscript)) return rawTranscript;
    if (typeof rawTranscript === 'string') {
      try {
        const parsed = JSON.parse(rawTranscript);
        if (Array.isArray(parsed)) return parsed;
      } catch {
        if (rawTranscript.trim()) {
          return [{ speaker: 'Speaker 1', text: rawTranscript.trim(), startTime: 0 }];
        }
      }
    }
    return [];
  }, [rawTranscript]);

  const durationLabel = session.duration_seconds > 0 ? formatDurationSeconds(session.duration_seconds) : null;
  const isError = session.status === 'error';
  const noSpeech = isError && !normalizedTranscript.length;
  const processingError = session._processingError || null;
  const notionUrl = uploadResult || session.notion_page_url;

  // Pipeline state: live progress from the app when it's for this session,
  // otherwise fall back to the stored status.
  const liveProcessing = processing?.sessionId === session.id ? processing : null;
  const busy = !!liveProcessing || isProcessing(session.status) || starting;
  const stage = liveProcessing?.stage || (isProcessing(session.status) ? session.status : 'transcribing');
  const includeNotion = stage === 'uploading'
    || !!(config?.notionToken?.trim?.() && config?.notionDatabaseId?.trim?.());

  const title = notesTitle(notes, session);
  const showEditor = editMode === 'markdown' && !!savedNotes && !busy;

  // Starts a pipeline run and hands progress tracking to the app shell.
  const startPipeline = async (run) => {
    setStarting(true);
    try {
      const result = await run();
      if (result?.success === false) {
        addToast(result.error || 'Could not start processing.', 'error');
        return;
      }
      trackProcessing(session.id);
      await onRefresh?.();
    } catch (err) {
      addToast(err.message || 'Could not start processing.', 'error');
    } finally {
      setStarting(false);
    }
  };

  const handleGenerate = () => startPipeline(() => window.meetmind.processing.run(session.id));
  const handleRetry = () => startPipeline(() => window.meetmind.processing.retry(session.id, 'all'));

  const handleRegenerate = async () => {
    const ok = await confirm({
      title: 'Regenerate notes?',
      message: savedNotes?._editedAt
        ? 'The current notes will be replaced with a new version generated from the transcript. Your edits will be lost.'
        : 'The current notes will be replaced with a new version generated from the transcript.',
      confirmLabel: 'Regenerate',
    });
    if (!ok) return;
    setRegenerating(true);
    try {
      await startPipeline(() => window.meetmind.processing.retry(session.id, 'notes'));
    } finally {
      setRegenerating(false);
    }
  };

  // First sync creates the Notion page. Updating replaces it: the main process creates a fresh
  // page from the current notes, then moves the old one to Notion's trash (no duplicates).
  const handleSyncNotion = async () => {
    const updating = !!notionUrl;
    if (updating) {
      const ok = await confirm({
        title: 'Update the Notion page?',
        message: 'MeetMind creates a fresh page with the current notes and moves the old one to Notion’s trash, where you can restore it for 30 days. Edits made directly in Notion won’t carry over.',
        confirmLabel: 'Update page',
      });
      if (!ok) return;
    }
    setUploading(true);
    try {
      const result = await window.meetmind.notion.upload(session.id);
      if (result?.success) {
        setUploadResult(result.url);
        addToast(updating ? 'Notion page updated.' : 'Notes synced to Notion.', 'success', {
          label: 'Open',
          onClick: () => window.meetmind.shell.openExternal(result.url),
        });
        onRefresh?.();
      } else {
        addToast(result?.error || 'Notion upload failed.', 'error');
      }
    } catch (err) {
      addToast(err.message || 'Notion upload failed.', 'error');
    } finally {
      setUploading(false);
    }
  };

  // Builds the PDF here (same Markdown rendering as the app) and lets the main process save it
  // to the configured folder (Downloads by default) as date-time-title.pdf.
  const handleExportPdf = async () => {
    if (!notes || exporting) return;
    setExporting(true);
    try {
      // Loaded on demand: it pulls in react-dom/server and the embedded font.
      const { buildPdfHtml } = await import('./note/pdfDocument.jsx');
      const html = buildPdfHtml(session, notes, normalizedTranscript, {
        includeTranscript: !!config?.pdfIncludeTranscript,
      });
      const result = await window.meetmind.pdf.export(session.id, html);
      if (result?.success) {
        const fileName = result.path.split(/[\\/]/).pop();
        addToast(`Saved ${fileName}`, 'success', {
          label: 'Show in folder',
          onClick: () => window.meetmind.pdf.reveal(result.path),
        });
      } else {
        addToast(result?.error || 'PDF export failed.', 'error');
      }
    } catch (err) {
      addToast(`PDF export failed: ${err.message}`, 'error');
    } finally {
      setExporting(false);
    }
  };

  const handleCopy = async () => {
    if (!notes) return;
    try {
      await navigator.clipboard.writeText(buildNotesMarkdown(notes, session));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      addToast(`Couldn't copy notes: ${err.message}`, 'error');
    }
  };

  // Toast actions outlive this render, so they call the latest handler.
  const handleSyncNotionRef = useRef(null);
  handleSyncNotionRef.current = handleSyncNotion;

  const handleSaveEdits = useCallback(async () => {
    if (!dirty || saving) return;
    setSaving(true);
    try {
      const next = { ...parseNotesMarkdown(draft, savedNotes), _editedAt: new Date().toISOString() };
      const result = await window.meetmind.sessions.updateNotes(session.id, next);
      if (!result?.success) {
        addToast(result?.error || 'Couldn’t save the notes.', 'error');
        return;
      }
      // What was saved, normalised, so the draft is clean once the session reloads.
      setDraft(buildNotesMarkdown(next, session));
      await onRefresh?.();
      setSaved(true);
      if (notionUrl) {
        addToast('Notes saved. The Notion page still has the previous version.', 'success', {
          label: 'Update Notion',
          onClick: () => handleSyncNotionRef.current?.(),
        });
      }
    } catch (err) {
      addToast(`Couldn’t save the notes: ${err.message}`, 'error');
    } finally {
      setSaving(false);
    }
  }, [dirty, saving, draft, savedNotes, session, notionUrl, addToast, onRefresh]);

  const handleDiscardEdits = () => setDraft(savedMarkdown);

  useEffect(() => {
    if (!saved) return undefined;
    const t = setTimeout(() => setSaved(false), 2500);
    return () => clearTimeout(t);
  }, [saved]);

  // Ctrl/Cmd+S saves while there are edits.
  useEffect(() => {
    if (!dirty) return undefined;
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        handleSaveEdits();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dirty, handleSaveEdits]);

  // Guard navigation away from the meeting while there are unsaved edits.
  useEffect(() => {
    if (dirty) {
      setNavGuard(() => confirm({
        title: 'Discard unsaved edits?',
        message: 'Your edits to these notes haven’t been saved.',
        confirmLabel: 'Discard',
        cancelLabel: 'Keep editing',
        destructive: true,
      }));
    } else {
      setNavGuard(null);
    }
  }, [dirty, setNavGuard, confirm]);

  useEffect(() => () => setNavGuard(null), [setNavGuard]);

  const changeTab = (tab) => {
    setActiveTab(tab);
    scrollRef.current?.scrollTo({ top: 0 });
  };

  const tabs = [
    { value: 'summary', label: 'Summary', icon: FileText },
    {
      value: 'transcript',
      label: 'Transcript',
      icon: Mic,
      count: normalizedTranscript.length > 0 ? normalizedTranscript.length : null,
    },
    { value: 'audio', label: 'Audio', icon: Volume2 },
  ];

  return (
    <div className="h-full flex flex-col overflow-hidden fade-in">
      <NoteToolbar
        title={title}
        showTitle={titleHidden}
        notes={notes}
        tabs={tabs}
        activeTab={activeTab}
        onTabChange={changeTab}
        onBack={onBack}
        busy={busy}
        copied={copied}
        onCopy={handleCopy}
        regenerating={regenerating}
        onRegenerate={handleRegenerate}
        notionUrl={notionUrl}
        uploading={uploading}
        onSyncNotion={handleSyncNotion}
        exporting={exporting}
        onExportPdf={handleExportPdf}
        editing={dirty}
      />

      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto">
        <div className="mx-auto w-full max-w-[880px] px-32 pb-64">
          <NoteTitleBlock
            ref={titleRef}
            session={session}
            notes={notes}
            title={title}
            durationLabel={durationLabel}
            processingError={processingError}
            aside={activeTab === 'summary' && savedNotes && (
              <SegmentedControl
                label="Notes view"
                role="radiogroup"
                options={EDIT_MODES}
                value={showEditor ? 'markdown' : 'preview'}
                onChange={setEditMode}
                size="sm"
                revealIcon
                disabled={busy}
              />
            )}
          />
          {activeTab === 'summary' && (
            <div className="space-y-48 pt-24">
              {busy && (
                <ProcessingCard
                  stage={stage}
                  percent={liveProcessing?.percent}
                  includeNotion={includeNotion}
                  onRestart={!liveProcessing && !starting ? handleRetry : undefined}
                />
              )}
              {showEditor ? (
                <MarkdownEditor value={draft} onChange={setDraft} structured={!savedNotes._rawMarkdown} />
              ) : (
                <SummaryTab
                  notes={notes}
                  title={title}
                  noSpeech={noSpeech}
                  isError={isError}
                  busy={busy}
                  onGenerate={handleGenerate}
                  onRetry={handleRetry}
                />
              )}
            </div>
          )}
          {(dirty || saving || saved) && (
            <SaveBar
              className="mt-32"
              dirty={dirty}
              saving={saving}
              saved={saved}
              onSave={handleSaveEdits}
              onDiscard={handleDiscardEdits}
            />
          )}
          {activeTab === 'transcript' && (
            <TranscriptViewer transcript={normalizedTranscript} />
          )}
          {activeTab === 'audio' && (
            <div className="pt-24">
              <AudioPlayer
                sessionId={session.id}
                title={title}
                durationLabel={durationLabel}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
