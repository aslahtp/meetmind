import React, { useState, useEffect, useCallback } from 'react';
import { Loader2, Volume2 } from 'lucide-react';
import { StatusDot } from '../ui/index';
import { SettingsGroup, SettingRow, RowList } from './SettingsParts';
import { useApp } from '../../lib/app-context';
import { CAPTURE_TEST_SECONDS, describeAudioTest, runCaptureTest } from '../../lib/audioTest';
import type { LinuxAudioStatus } from '@shared';

type CaptureTestResult = Awaited<ReturnType<typeof runCaptureTest>>;

// Linux only (rendered by SystemSection): the audio server MeetMind records from, whether the
// FFmpeg fallback can record from it, and a test of system audio capture. Recording first tries
// Electron's loopback; when that hears nothing, MeetMind records the default output's monitor
// with FFmpeg instead.

interface StatusProps {
  tone: React.ComponentProps<typeof StatusDot>['tone'];
  children?: React.ReactNode;
}

function Status({ tone, children }: StatusProps) {
  return (
    <span className="inline-flex items-center gap-8 text-caption text-ink">
      <StatusDot tone={tone} />
      {children}
    </span>
  );
}

export default function LinuxAudio() {
  const { isRecording } = useApp();
  const [status, setStatus] = useState<LinuxAudioStatus | null>(null);
  const [result, setResult] = useState<CaptureTestResult | null>(null);
  const [testing, setTesting] = useState(false);

  const refresh = useCallback(async () => {
    try { setStatus(await window.meetmind.recording.linuxStatus()); } catch { /* keep the last status */ }
  }, []);

  useEffect(() => {
    refresh();
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, [refresh]);

  const handleTest = async () => {
    setTesting(true);
    setResult(null);
    setResult(await runCaptureTest('screen'));
    setTesting(false);
  };

  const verdict = describeAudioTest(result);
  // Anything but the Linux-only error carries the audio server's details.
  const details = status && 'server' in status ? status : null;
  const serverFound = !!details?.server;

  return (
    <SettingsGroup
      title="System audio"
      description="MeetMind records what your default output device plays, through PulseAudio or PipeWire."
      icon={<Volume2 size={20} strokeWidth={1.75} className="text-ink" />}
    >
      <RowList>
        <SettingRow
          label="Audio server"
          description={details?.defaultSink ? `Output: ${details.defaultSink}` : 'Where meeting audio is played.'}
        >
          {status && (
            <Status tone={serverFound ? 'ok' : 'error'}>{serverFound ? details?.server : 'Not found'}</Status>
          )}
        </SettingRow>
        <SettingRow
          label="FFmpeg fallback"
          description="Records the output’s monitor when the app can’t capture system audio itself."
        >
          {status && (
            <Status tone={details?.ffmpegPulse && serverFound ? 'ok' : 'warning'}>
              {details?.ffmpegPulse && serverFound ? 'Available' : 'Unavailable'}
            </Status>
          )}
        </SettingRow>
        <div className="space-y-8">
          <SettingRow
            label="Test system audio"
            description={`Play something (a video, music), then test; it records ${CAPTURE_TEST_SECONDS} seconds.`}
          >
            <button type="button" onClick={handleTest} disabled={testing || isRecording} className="btn-ghost btn-sm">
              {testing ? (
                <>
                  <Loader2 size={14} strokeWidth={2} className="spinner" />
                  Testing…
                </>
              ) : 'Test'}
            </button>
          </SettingRow>
          {verdict && (
            <p className={`flex items-start gap-8 text-caption ${verdict.tone === 'error' ? 'text-signal' : 'text-ink'}`} role="status">
              <StatusDot tone={verdict.tone} className="mt-4" />
              <span>{verdict.text}</span>
            </p>
          )}
        </div>
      </RowList>
      {status && !serverFound && (
        <p className="hint">
          MeetMind needs pactl to find your audio devices. Install the pulseaudio-utils package (on Ubuntu and
          Debian: sudo apt install pulseaudio-utils), then reopen this page.
        </p>
      )}
      {verdict && verdict.tone !== 'ok' && details?.ffmpegPulse && serverFound && (
        <p className="hint">Recordings still include system audio: MeetMind switches to the FFmpeg fallback.</p>
      )}
      {isRecording && <p className="hint">Stop the current recording to run a test.</p>}
    </SettingsGroup>
  );
}
