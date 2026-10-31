import React, { useState, useEffect, useCallback } from 'react';
import { Loader2, ShieldCheck, Volume2 } from 'lucide-react';
import { StatusDot } from '../ui/index.jsx';
import { SettingsGroup, SettingRow, RowList } from './SettingsParts.jsx';
import { useApp } from '../../lib/app-context.js';
import { CAPTURE_STRATEGIES, CAPTURE_TEST_SECONDS as TEST_SECONDS, describeAudioTest, runCaptureTest } from '../../lib/audioTest.js';

// macOS only (rendered by SystemSection): the privacy permissions MeetMind needs, and a test that
// records 3 seconds of system audio with each capture method so a tester can see which one works
// on their Mac and switch to it.

const PERMISSIONS = [
  {
    kind: 'microphone',
    label: 'Microphone',
    description: 'Records your voice.',
  },
  {
    kind: 'screen',
    label: 'Screen & System Audio Recording',
    description: 'Records the other participants. Also lets meeting detection read browser tab titles.',
  },
];

const STATUS = {
  granted: { tone: 'ok', text: 'Allowed' },
  denied: { tone: 'error', text: 'Denied' },
  restricted: { tone: 'error', text: 'Blocked by a profile' },
  'not-determined': { tone: 'neutral', text: 'Not asked yet' },
};

export default function MacPermissions() {
  const { config, updateConfig, isRecording } = useApp();
  const [status, setStatus] = useState(null);
  const [results, setResults] = useState({});     // strategy id → test result
  const [testing, setTesting] = useState(null);   // strategy id being tested

  const refresh = useCallback(async () => {
    try { setStatus(await window.meetmind.permissions.status()); } catch { /* keep the last status */ }
  }, []);

  // Re-read when the window regains focus, e.g. back from System Settings.
  useEffect(() => {
    refresh();
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, [refresh]);

  const handlePermission = async (kind) => {
    if (status?.[kind] === 'not-determined') {
      await window.meetmind.permissions.request(kind);
      await refresh();
    } else {
      await window.meetmind.permissions.openSettings(kind);
    }
  };

  const handleTest = async (strategy) => {
    setTesting(strategy);
    setResults((prev) => ({ ...prev, [strategy]: null }));
    const result = await runCaptureTest(strategy);
    setResults((prev) => ({ ...prev, [strategy]: result }));
    setTesting(null);
    refresh();
  };

  const current = config?.macCaptureStrategy || 'screen';

  return (
    <>
      <SettingsGroup
        title="Permissions"
        description="macOS asks before an app can use the microphone or record system audio."
        icon={<ShieldCheck size={20} strokeWidth={1.75} className="text-ink" />}
      >
        <RowList>
          {PERMISSIONS.map(({ kind, label, description }) => {
            const s = STATUS[status?.[kind]] || { tone: 'neutral', text: 'Unknown' };
            const allowed = status?.[kind] === 'granted';
            return (
              <SettingRow key={kind} label={label} description={description}>
                <div className="flex items-center gap-16">
                  <span className="inline-flex items-center gap-8 text-caption text-ink">
                    <StatusDot tone={s.tone} />
                    {s.text}
                  </span>
                  {!allowed && (
                    <button type="button" onClick={() => handlePermission(kind)} className="btn-ghost btn-sm">
                      {status?.[kind] === 'not-determined' ? 'Allow' : 'Open System Settings'}
                    </button>
                  )}
                </div>
              </SettingRow>
            );
          })}
        </RowList>
        <p className="hint">
          This beta isn’t signed by Apple, so macOS forgets these permissions after each update; allow them again
          afterwards. If MeetMind shows as allowed but still can’t record, remove it from the list in System Settings
          and allow it again.
        </p>
      </SettingsGroup>

      <SettingsGroup
        title="Test system audio"
        description={`Play something (a video, music) and test each method; each records ${TEST_SECONDS} seconds. Use the one that hears audio.`}
        icon={<Volume2 size={20} strokeWidth={1.75} className="text-ink" />}
      >
        <RowList>
          {CAPTURE_STRATEGIES.map(({ id, label, description }) => {
            const verdict = describeAudioTest(results[id]);
            const inUse = current === id;
            return (
              <div key={id} className="space-y-8">
                <SettingRow label={`${label}${inUse ? ' · in use' : ''}`} description={description}>
                  <div className="flex items-center gap-8">
                    <button
                      type="button"
                      onClick={() => handleTest(id)}
                      disabled={!!testing || isRecording}
                      className="btn-ghost btn-sm"
                    >
                      {testing === id ? (
                        <>
                          <Loader2 size={14} strokeWidth={2} className="spinner" />
                          Testing…
                        </>
                      ) : 'Test'}
                    </button>
                    {!inUse && results[id] && verdict?.tone === 'ok' && (
                      <button type="button" onClick={() => updateConfig('macCaptureStrategy', id)} className="btn-ink btn-sm">
                        Use this method
                      </button>
                    )}
                  </div>
                </SettingRow>
                {verdict && (
                  <p className={`flex items-start gap-8 text-caption ${verdict.tone === 'error' ? 'text-signal' : 'text-ink'}`} role="status">
                    <StatusDot tone={verdict.tone} className="mt-4" />
                    <span>{verdict.text}</span>
                  </p>
                )}
              </div>
            );
          })}
        </RowList>
        {isRecording && <p className="hint">Stop the current recording to run a test.</p>}
      </SettingsGroup>
    </>
  );
}
