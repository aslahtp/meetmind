import React, { useEffect, useState } from 'react';
import { Loader2, VolumeX, HardDrive } from 'lucide-react';
import { useApp } from '../../lib/app-context';
import { formatDate } from '../../lib/format';
import { requestSettingsTab } from '../../lib/settingsTab';
import { EmptyState } from '../ui/index';
import AudioPlayer from './AudioPlayer';

// A meeting's Audio tab: the player when there's a recording, otherwise why there isn't one
// (deleted from Settings › Storage, made from a pasted transcript, or missing).
export default function SessionAudio({ session, title, durationLabel, showWaveform }: { session?: any; title?: any; durationLabel?: any; showWaveform?: any }) {
  const { setView } = useApp();
  // null while checking; then { available, deletedAt, source }
  const [status, setStatus] = useState<any>(null);

  useEffect(() => {
    if (!window.meetmind?.sessions?.audioStatus) {
      setStatus({ available: true });
      return undefined;
    }
    let cancelled = false;
    setStatus(null);
    window.meetmind.sessions.audioStatus(session.id)
      .then((result) => { if (!cancelled) setStatus(result || { available: false }); })
      // If the check itself fails, let the player try (it reports its own errors).
      .catch(() => { if (!cancelled) setStatus({ available: true }); });
    return () => { cancelled = true; };
  }, [session.id, session.audio_path, session.audio_deleted_at]);

  if (!status) {
    return (
      <p className="text-caption text-graphite flex items-center justify-center gap-8 py-48">
        <Loader2 size={14} strokeWidth={2} className="spinner" />
        Loading audio…
      </p>
    );
  }

  if (status.available) {
    return (
      <AudioPlayer sessionId={session.id} title={title} durationLabel={durationLabel} showWaveform={showWaveform} />
    );
  }

  if (status.deletedAt) {
    const openStorage = () => {
      requestSettingsTab('storage');
      setView('settings');
    };
    return (
      <EmptyState
        compact
        icon={<VolumeX size={24} strokeWidth={1.75} />}
        title="Recording deleted"
        message={`This recording was deleted on ${formatDate(status.deletedAt)} to free up space. The notes and transcript are kept.`}
        action={
          <button type="button" onClick={openStorage} className="btn-ghost">
            <HardDrive size={16} strokeWidth={1.75} />
            Storage settings
          </button>
        }
      />
    );
  }

  return (
    <EmptyState
      compact
      icon={<VolumeX size={24} strokeWidth={1.75} />}
      title="No recording"
      message={status.source === 'transcript'
        ? 'This meeting was created from a pasted transcript, so it has no audio.'
        : 'There’s no audio file for this meeting.'}
    />
  );
}
