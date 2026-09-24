import React, { useState, useMemo, useRef, useEffect } from 'react';
import { FileText, Mic, Volume2, MicOff, Sparkles, Loader2 } from 'lucide-react';
import { useApp } from '../lib/app-context.js';
import TranscriptViewer from './TranscriptViewer.jsx';
import { NoteToolbar, NoteTitleBlock } from './note/NoteHeader.jsx';
import SummaryJson from './note/SummaryJson.jsx';
import AudioPlayer from './note/AudioPlayer.jsx';
import { MarkdownNoteView } from './note/markdown.jsx';
import { buildNotesMarkdown, notesTitle } from './note/copyMarkdown.js';
import { EmptyState, StepBadge, ProgressBar } from './ui/index.jsx';
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

// ── Main NoteViewer ──────────────────────────────────────────────────────────

export default function NoteViewer({ session, onBack, onRefresh }) {
  const { processing, trackProcessing, addToast, confirm, config } = useApp();
  const [activeTab, setActiveTab] = useState('summary');
  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState(null);
  const [regenerating, setRegenerating] = useState(false);
  const [starting, setStarting] = useState(false);
  const [copied, setCopied] = useState(false);
  const [titleHidden, setTitleHidden] = useState(false);
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

  const notes = session.notes;
  const rawTranscript = session.transcript;

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
      message: 'The current notes will be replaced with a new version generated from the transcript.',
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

  const handleSyncNotion = async () => {
    setUploading(true);
    try {
      const result = await window.meetmind.notion.upload(session.id);
      if (result?.success) {
        setUploadResult(result.url);
        addToast('Notes synced to Notion.', 'success');
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
              <SummaryTab
                notes={notes}
                title={title}
                noSpeech={noSpeech}
                isError={isError}
                busy={busy}
                onGenerate={handleGenerate}
                onRetry={handleRetry}
              />
            </div>
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
