import React, { useState, useRef } from 'react';
import { Volume2, Play, Pause, FolderOpen, Loader2, AlertTriangle } from 'lucide-react';
import { AvatarTile } from '../ui/index.jsx';

const SPEEDS = [1, 1.25, 1.5, 2];

function formatPlayerTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export default function AudioPlayer({ sessionId, title, durationLabel }) {
  const audioRef = useRef(null);
  const [speed, setSpeed] = useState(1);
  const [error, setError] = useState(null);
  const [ready, setReady] = useState(false);
  const [opening, setOpening] = useState(false);
  const [openMessage, setOpenMessage] = useState(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

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

  const seek = (e) => {
    if (!audioRef.current || !duration) return;
    const value = Number(e.target.value);
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

          <div className="space-y-8">
            <input
              type="range"
              min={0}
              max={duration || 0}
              step={0.1}
              value={Math.min(currentTime, duration || 0)}
              onChange={seek}
              disabled={!ready || !duration}
              aria-label="Seek"
              aria-valuetext={`${formatPlayerTime(currentTime)} of ${formatPlayerTime(duration)}`}
              className="w-full cursor-pointer disabled:cursor-not-allowed"
              style={{ accentColor: 'rgb(var(--color-ink))' }}
            />
            <div className="flex items-center justify-between text-caption text-graphite tabular">
              <span>{formatPlayerTime(currentTime)}</span>
              <span>{formatPlayerTime(duration)}</span>
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
              setDuration(audioRef.current?.duration || 0);
              if (audioRef.current) audioRef.current.playbackRate = speed;
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
