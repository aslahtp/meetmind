import React, { useState, useRef, useEffect } from 'react';
import { Volume2, Play, Pause, FolderOpen, Loader2, AlertTriangle } from 'lucide-react';
import { AvatarTile } from '../ui/index.jsx';
import Waveform from './Waveform.jsx';

const SPEEDS = [1, 1.25, 1.5, 2];

function formatPlayerTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export default function AudioPlayer({ sessionId, title, durationLabel, showWaveform = true }) {
  const audioRef = useRef(null);
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
            <div className="flex items-center justify-between text-caption text-graphite tabular">
              <span>{formatPlayerTime(currentTime)}</span>
              <span>{formatPlayerTime(effectiveDuration)}</span>
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

      <div className="flex items-center justify-center gap-8 mt-32">
        <button
          type="button"
          onClick={changeSpeed}
          className="pill tabular"
          aria-label={`Playback speed ${speed}x. Click to change.`}
        >
          {speed}x
        </button>
        <button
          type="button"
          onClick={openRecordingFile}
          disabled={opening}
          className="btn-ghost btn-sm"
          title="Show recording file in Explorer"
        >
          {opening ? (
            <Loader2 size={14} strokeWidth={2} className="spinner" />
          ) : (
            <FolderOpen size={14} strokeWidth={1.75} />
          )}
          Open file
        </button>
      </div>

      {openMessage && (
        <p role="alert" className="text-caption text-signal mt-16">{openMessage}</p>
      )}
    </div>
  );
}
