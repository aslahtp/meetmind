import React from 'react';
import { Sun, Moon, Monitor } from 'lucide-react';
import { useApp } from '../../lib/app-context.js';
import { SegmentedControl, Switch } from '../ui/index.jsx';
import { SettingsGroup, SettingRow, RowList } from './SettingsParts.jsx';

const THEME_OPTIONS = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'System', icon: Monitor },
];

const RECENT_LIMIT_OPTIONS = [5, 10, 15].map((n) => ({ value: n, label: String(n) }));

export default function GeneralSection({ form, onChange }) {
  const { theme, setTheme } = useApp();

  return (
    <div className="space-y-24">
      <SettingsGroup title="Appearance" description="Theme changes apply immediately.">
        <RowList>
          <SettingRow label="Theme" description="Follow Windows or choose a theme.">
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
        </RowList>
      </SettingsGroup>

      <SettingsGroup title="Startup & updates">
        <RowList>
          <SettingRow
            label="Launch on startup"
            description="Start MeetMind automatically when Windows starts."
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
            label="Automatic updates"
            description="Check for and download app updates automatically."
            htmlFor="pref-auto-updates"
          >
            <Switch
              id="pref-auto-updates"
              label="Automatic updates"
              checked={form.autoCheckUpdates !== false}
              onChange={(v) => onChange('autoCheckUpdates', v)}
            />
          </SettingRow>
        </RowList>
      </SettingsGroup>
    </div>
  );
}
