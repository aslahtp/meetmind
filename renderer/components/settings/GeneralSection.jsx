import React, { useEffect, useState } from 'react';
import { Sun, Moon, Monitor, Palette, Power, Radar } from 'lucide-react';
import { useApp } from '../../lib/app-context.js';
import { SegmentedControl, Switch } from '../ui/index.jsx';
import { SettingsGroup, SettingRow, RowList } from './SettingsParts.jsx';
import { isMac, isLinux } from '../../lib/os.js';

const THEME_OPTIONS = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'System', icon: Monitor },
];

const RECENT_LIMIT_OPTIONS = [5, 10, 15].map((n) => ({ value: n, label: String(n) }));

export default function GeneralSection({ form, onChange }) {
  const { theme, setTheme } = useApp();
  // Unsigned macOS builds and Linux .deb installs can't replace themselves; updates there are
  // downloaded from GitHub.
  const [canSelfUpdate, setCanSelfUpdate] = useState(!isMac);
  useEffect(() => {
    window.meetmind?.updater?.getStatus?.()
      .then((s) => { if (typeof s?.canSelfUpdate === 'boolean') setCanSelfUpdate(s.canSelfUpdate); })
      .catch(() => {});
  }, []);

  return (
    <div className="space-y-24">
      <SettingsGroup
        title="Appearance"
        description="Theme changes apply immediately."
        icon={<Palette size={20} strokeWidth={1.75} className="text-ink" />}
      >
        <RowList>
          <SettingRow label="Theme" description="Follow your system or choose a theme.">
            <SegmentedControl
              role="radiogroup"
              label="Theme"
              options={THEME_OPTIONS}
              value={theme}
              onChange={setTheme}
            />
          </SettingRow>
          <SettingRow label="Recent meetings on Dashboard" description="How many recent meetings the Dashboard lists.">
            <SegmentedControl
              role="radiogroup"
              label="Recent meetings on Dashboard"
              options={RECENT_LIMIT_OPTIONS}
              value={form.dashboardRecentLimit}
              onChange={(n) => onChange('dashboardRecentLimit', n)}
            />
          </SettingRow>
          <SettingRow
            label="Show Logs in navigation"
            description="Adds the Logs viewer to the top bar."
            htmlFor="pref-show-logs"
          >
            <Switch
              id="pref-show-logs"
              label="Show Logs in navigation"
              checked={!form.hideLogsInSidebar}
              onChange={(show) => onChange('hideLogsInSidebar', !show)}
            />
          </SettingRow>
          <SettingRow
            label="Pin the notes view toggle"
            description="Keeps Preview / Markdown as icons in the top-right corner after you scroll past a meeting’s title."
            htmlFor="pref-pin-notes-toggle"
          >
            <Switch
              id="pref-pin-notes-toggle"
              label="Pin the notes view toggle"
              checked={form.pinNotesViewToggle !== false}
              onChange={(v) => onChange('pinNotesViewToggle', v)}
            />
          </SettingRow>
          <SettingRow
            label="Audio waveform"
            description="Shows the recording’s waveform in a meeting’s Audio tab. Turn off for a plain seek bar."
            htmlFor="pref-audio-waveform"
          >
            <Switch
              id="pref-audio-waveform"
              label="Audio waveform"
              checked={form.showAudioWaveform !== false}
              onChange={(v) => onChange('showAudioWaveform', v)}
            />
          </SettingRow>
        </RowList>
      </SettingsGroup>

      <SettingsGroup
        title="Meeting detection"
        description="Works without the browser extension."
        icon={<Radar size={20} strokeWidth={1.75} className="text-ink" />}
      >
        <RowList>
          <SettingRow
            label="Detect meetings"
            description={isMac
              ? 'Not available on macOS yet. Start recordings with Record, or from the Chrome extension.'
              : isLinux
                ? 'Shows a floating prompt to record when the Zoom app, or Google Meet, Zoom or Teams in a browser, starts using your microphone. Browser meetings are detected on X11 sessions; on Wayland, use the Chrome extension.'
                : 'Shows a floating prompt to record when Google Meet, Zoom or Teams starts using your microphone, and keeps a timer on screen while you record.'}
            htmlFor={isMac ? undefined : 'pref-meeting-detection'}
          >
            {!isMac && (
              <Switch
                id="pref-meeting-detection"
                label="Detect meetings"
                checked={form.meetingDetection !== false}
                onChange={(v) => onChange('meetingDetection', v)}
              />
            )}
          </SettingRow>
        </RowList>
      </SettingsGroup>

      <SettingsGroup title="Startup & updates" icon={<Power size={20} strokeWidth={1.75} className="text-ink" />}>
        <RowList>
          <SettingRow
            label="Launch on startup"
            description={isMac
              ? 'Start MeetMind automatically when you log in.'
              : 'Start MeetMind in the tray when you log in, ready to detect meetings.'}
            htmlFor="pref-auto-launch"
          >
            <Switch
              id="pref-auto-launch"
              label="Launch on startup"
              checked={!!form.autoLaunch}
              onChange={(v) => onChange('autoLaunch', v)}
            />
          </SettingRow>
          <SettingRow
            label="Check for updates automatically"
            description="Looks for a new version when MeetMind starts and every few hours, and shows it in the top bar."
            htmlFor="pref-auto-updates"
          >
            <Switch
              id="pref-auto-updates"
              label="Check for updates automatically"
              checked={form.autoCheckUpdates !== false}
              onChange={(v) => onChange('autoCheckUpdates', v)}
            />
          </SettingRow>
          <SettingRow
            label="Download and install updates automatically"
            description={!canSelfUpdate
              ? (isLinux
                ? 'Only the AppImage updates itself. For the .deb, MeetMind tells you when a new version is out and links to it.'
                : 'Not available on macOS yet: new versions download from GitHub.')
              : form.autoCheckUpdates === false
                ? 'Turn on automatic checks to use this.'
                : 'Downloads new versions in the background and installs them when MeetMind is idle in the tray or quits. Never during a recording.'}
            htmlFor={canSelfUpdate ? 'pref-auto-install' : undefined}
          >
            {canSelfUpdate && (
              <Switch
                id="pref-auto-install"
                label="Download and install updates automatically"
                checked={form.autoCheckUpdates !== false && form.autoInstallUpdates === true}
                disabled={form.autoCheckUpdates === false}
                onChange={(v) => onChange('autoInstallUpdates', v)}
              />
            )}
          </SettingRow>
        </RowList>
      </SettingsGroup>
    </div>
  );
}
