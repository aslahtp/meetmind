import React, { useState, useRef, useEffect } from 'react';
import { Volume2, Play, Pause, FolderOpen, Loader2, AlertTriangle, FileAudio, Trash2 } from 'lucide-react';
import { useApp } from '../../lib/app-context.js';
import { formatBytes } from '../../lib/format.js';
import { isMac, isLinux } from '../../lib/os.js';
import { AvatarTile } from '../ui/index.jsx';
import Waveform from './Waveform.jsx';

const FILE_MANAGER = isMac ? 'Finder' : isLinux ? 'your file manager' : 'Explorer';

const SPEEDS = [1, 1.25, 1.5, 2];

function formatPlayerTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

// file: { bytes, format } of the recording; busy: it's being recorded or processed, so it can't be
// deleted; onDeleted: called once its audio is gone.
export default function AudioPlayer({ sessionId, title, durationLabel, showWaveform = true, file, busy = false, onDeleted }) {
  const { confirm, addToast } = useApp();
  const audioRef = useRef(null);
  const [deleting, setDeleting] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [error, setError] = useState(null);
  const [ready, setReady] = useState(false);
  const [opening, setOpening] = useState(false);
  const [openMessage, setOpenMessage] = useState(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  // { status: 'loading' | 'ready' | 'error', peaks, duration } — computed once per recording in main.
  const [waveform, setWaveform] = useState(null);

  useEffect(() => {
    if (!showWaveform || !sessionId || !window.meetmind?.sessions?.waveform) {
      setWaveform(null);
      return undefined;
    }
    let cancelled = false;
    setWaveform({ status: 'loading', peaks: null, duration: 0 });
    window.meetmind.sessions.waveform(sessionId)
      .then((result) => {
        if (cancelled) return;
        setWaveform(result?.success
          ? { status: 'ready', peaks: result.peaks, duration: result.duration || 0 }
          : { status: 'error', peaks: null, duration: 0 });
      })
      .catch(() => {
        if (!cancelled) setWaveform({ status: 'error', peaks: null, duration: 0 });
      });
    return () => { cancelled = true; };
  }, [sessionId, showWaveform]);

  // timeupdate fires only ~4x a second; follow the playhead per frame so the waveform moves smoothly.
  useEffect(() => {
    if (!playing) return undefined;
    let raf;
    const tick = () => {
      if (audioRef.current) setCurrentTime(audioRef.current.currentTime);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  // Recorder webm files often report an Infinity duration; fall back to the decoded length.
  const effectiveDuration = duration || waveform?.duration || 0;
  const useWaveform = showWaveform && waveform && waveform.status !== 'error';

  const audioSrc = sessionId ? `meetmind-audio://session/${sessionId}` : '';

  const changeSpeed = () => {
    const nextSpeed = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length];
    setSpeed(nextSpeed);
    if (audioRef.current) audioRef.current.playbackRate = nextSpeed;
  };

  const togglePlay = async () => {
    if (!audioRef.current || error) return;
    try {
      if (audioRef.current.paused) await audioRef.current.play();
      else audioRef.current.pause();
    } catch {
      setError('Unable to start playback. Try opening the recording file instead.');
    }
  };

  const seekTo = (value) => {
    if (!audioRef.current || !effectiveDuration) return;
    audioRef.current.currentTime = value;
    setCurrentTime(value);
  };

  const openRecordingFile = async () => {
    if (!sessionId || opening) return;
    setOpening(true);
    setOpenMessage(null);
    try {
      const result = await window.meetmind.sessions.openRecording(sessionId);
      if (!result?.success) {
        setOpenMessage(result?.error || 'Recording file not found for this session.');
      }
    } catch (err) {
      setOpenMessage(err.message || 'Failed to open recording file.');
    } finally {
      setOpening(false);
    }
  };

  const deleteRecording = async () => {
    if (!sessionId || deleting || busy) return;
    const size = file?.bytes > 0 ? ` (${formatBytes(file.bytes)})` : '';
    const ok = await confirm({
      title: 'Delete this recording?',
      message: `The audio file${size} will be deleted from this computer. The notes and transcript are kept, but this meeting can’t be played or transcribed again. This can’t be undone.`,
      confirmLabel: 'Delete recording',
      destructive: true,
    });
    if (!ok) return;

    setDeleting(true);
    // Let go of the file first so nothing here is reading it while it's deleted.
    const el = audioRef.current;
    if (el) {
      el.pause();
      el.removeAttribute('src');
      el.load();
    }
    try {
      const result = await window.meetmind.sessions.deleteRecording(sessionId);
      if (!result?.success) throw new Error(result?.error || 'unknown error');
      addToast(result.bytes > 0 ? `Recording deleted, freed ${formatBytes(result.bytes)}.` : 'Recording deleted.', 'success');
      onDeleted?.();
    } catch (err) {
      addToast(`Couldn’t delete the recording: ${err?.message || 'unknown error'}`, 'error');
      if (el) {
        el.src = audioSrc;
        el.load();
      }
      setDeleting(false);
    }
  };

  const fileMeta = [file?.format, file?.bytes > 0 ? formatBytes(file.bytes) : null].filter(Boolean).join(' · ');

  return (
    <div className="card max-w-[560px] mx-auto text-center fade-in">
      <div className="flex flex-col items-center">
        <AvatarTile size={64}>
          <Volume2 size={28} strokeWidth={1.75} />
        </AvatarTile>
        <h2 className="text-heading-sm font-medium text-ink mt-24 truncate max-w-full">
          {title || 'Session audio'}
        </h2>
        <p className="text-caption text-graphite mt-4">
          {durationLabel ? `${durationLabel} recording` : 'Session recording'}
        </p>
      </div>

      {error ? (
        <div role="alert" className="tile mt-32 p-16 flex items-start gap-8 text-left text-body-sm text-signal">
          <AlertTriangle size={16} strokeWidth={1.75} className="flex-shrink-0 mt-4" />
          <span>{error}</span>
        </div>
      ) : (
        <div className="mt-32 space-y-24">
          <button
            type="button"
            onClick={togglePlay}
            disabled={!ready}
            className="mx-auto w-64 h-64 rounded-full bg-ink text-paper flex items-center justify-center hover:bg-ink/80 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            aria-label={playing ? 'Pause' : 'Play'}
          >
            {playing ? (
              <Pause size={24} strokeWidth={1.75} fill="currentColor" />
            ) : (
              <Play size={24} strokeWidth={1.75} fill="currentColor" className="ml-4" />
            )}
          </button>

          <div className={useWaveform ? 'space-y-8 pt-8' : 'space-y-8'}>
            {useWaveform ? (
              <Waveform
                peaks={waveform.peaks}
                currentTime={currentTime}
                duration={effectiveDuration}
                disabled={!ready}
                onSeek={seekTo}
                formatTime={formatPlayerTime}
              />
            ) : (
              <input
                type="range"
                min={0}
                max={effectiveDuration}
                step={0.1}
                value={Math.min(currentTime, effectiveDuration)}
                onChange={(e) => seekTo(Number(e.target.value))}
                disabled={!ready || !effectiveDuration}
                aria-label="Seek"
                aria-valuetext={`${formatPlayerTime(currentTime)} of ${formatPlayerTime(effectiveDuration)}`}
                className="w-full cursor-pointer disabled:cursor-not-allowed"
                style={{ accentColor: 'rgb(var(--color-ink))' }}
              />
            )}
            <div className="flex items-center justify-between gap-16 text-caption text-graphite tabular">
              <span className="min-w-[48px] text-left">{formatPlayerTime(currentTime)}</span>
              <button
                type="button"
                onClick={changeSpeed}
                className="pill tabular"
                aria-label={`Playback speed ${speed}x. Click to change.`}
              >
                {speed}x
              </button>
              <span className="min-w-[48px] text-right">{formatPlayerTime(effectiveDuration)}</span>
            </div>
          </div>

          <audio
            ref={audioRef}
            key={sessionId}
            className="hidden"
            src={audioSrc}
            preload="metadata"
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onTimeUpdate={() => setCurrentTime(audioRef.current?.currentTime || 0)}
            onLoadedMetadata={() => {
              setReady(true);
              setError(null);
              const d = audioRef.current?.duration;
              setDuration(Number.isFinite(d) && d > 0 ? d : 0);
              if (audioRef.current) audioRef.current.playbackRate = speed;
            }}
            onDurationChange={() => {
              const d = audioRef.current?.duration;
              if (Number.isFinite(d) && d > 0) setDuration(d);
            }}
            onCanPlay={() => setReady(true)}
            onEnded={() => setPlaying(false)}
            onError={() => {
              setReady(false);
              setPlaying(false);
              setError('Audio file could not be loaded. The recording may be missing or still converting.');
            }}
          />

          {!ready && (
            <p className="text-caption text-graphite flex items-center justify-center gap-8">
              <Loader2 size={14} strokeWidth={2} className="spinner" />
              Loading audio…
            </p>
          )}
        </div>
      )}

      {/* ── The file: its size, where it is, and deleting it ─────────────── */}
      <div className="rule mt-32 pt-24 flex flex-wrap items-center gap-16 text-left">
        <AvatarTile size={40}>
          <FileAudio size={18} strokeWidth={1.75} />
        </AvatarTile>
        <div className="flex-1 min-w-[120px]">
          <p className="text-body-sm font-medium text-ink">Recording file</p>
          <p className="text-caption text-graphite tabular">{fileMeta || 'Saved on this computer'}</p>
        </div>
        <div className="flex items-center gap-8">
          <button
            type="button"
            onClick={openRecordingFile}
            disabled={opening || deleting}
            className="btn-ghost btn-sm"
            title={`Show the recording file in ${FILE_MANAGER}`}
          >
            {opening ? (
              <Loader2 size={14} strokeWidth={2} className="spinner" />
            ) : (
              <FolderOpen size={14} strokeWidth={1.75} />
            )}
            Show file
          </button>
          <button
            type="button"
            onClick={deleteRecording}
            disabled={deleting || busy}
            className="btn-danger btn-sm"
            aria-label="Delete recording"
            title={busy ? 'This meeting is being recorded or processed' : 'Delete the audio, keeping the notes and transcript'}
          >
            {deleting ? (
              <Loader2 size={14} strokeWidth={2} className="spinner" />
            ) : (
              <Trash2 size={14} strokeWidth={1.75} />
            )}
            Delete
          </button>
        </div>
      </div>

      {openMessage && (
        <p role="alert" className="text-caption text-signal mt-16">{openMessage}</p>
      )}
    </div>
  );
}
