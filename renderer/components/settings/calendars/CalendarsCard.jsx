import React, { useCallback, useEffect, useState } from 'react';
import { CalendarDays, Plus, RefreshCw } from 'lucide-react';
import { useApp } from '../../../lib/app-context.js';
import { useNow } from '../../../lib/hooks.js';
import { IconButton, SegmentedControl } from '../../ui/index.jsx';
import { SettingsGroup, SettingRow } from '../SettingsParts.jsx';
import CalendarRow from './CalendarRow.jsx';
import AddCalendarDialog from './AddCalendarDialog.jsx';
import EditCalendarDialog from './EditCalendarDialog.jsx';

const REMOVE_ANIMATION_MS = 300; // matches .card-deleting in globals.css

function syncLabel(minutes) {
  if (minutes === 60) return '1 h';
  return `${minutes} min`;
}

function syncPhrase(minutes) {
  if (minutes === 1) return 'every minute';
  if (minutes === 60) return 'every hour';
  return `every ${minutes} minutes`;
}

/**
 * Settings › Integrations › Calendars: up to 5 Google accounts and ICS links. Changes apply at
 * once (outside the Save bar), since adding one means checking a link or signing in anyway.
 */
export default function CalendarsCard() {
  const { confirm, addToast, updateConfig } = useApp();
  const [data, setData] = useState({ sources: [], max: 5, syncMinutes: 5, syncIntervals: [] });
  const [loaded, setLoaded] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [busy, setBusy] = useState({}); // sourceId → 'signin' | 'save'
  const [removing, setRemoving] = useState(null);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(null); // { source, field }
  const now = useNow(30_000);

  const refresh = useCallback(async () => {
    try {
      setData(await window.meetmind.calendar.list());
    } catch (err) {
      addToast(`Couldn’t load your calendars: ${err.message}`, 'error');
    } finally {
      setLoaded(true);
    }
  }, [addToast]);

  const sync = useCallback(async (force) => {
    setSyncing(true);
    try {
      await window.meetmind.calendar.getEvents({ force });
    } finally {
      setSyncing(false);
      refresh();
    }
  }, [refresh]);

  // List at once, then sync so every row shows how its calendar is doing.
  useEffect(() => {
    refresh().then(() => sync(false));
    return window.meetmind.on?.('calendar:changed', refresh);
  }, [refresh, sync]);

  // Background syncs update each calendar's status; re-read it as the clock ticks.
  useEffect(() => {
    if (loaded) refresh();
  }, [now, loaded, refresh]);

  const changeSyncInterval = async (minutes) => {
    setData((prev) => ({ ...prev, syncMinutes: minutes }));
    try {
      await updateConfig('calendarSyncMinutes', minutes);
    } catch (err) {
      addToast(`Couldn\u2019t change the sync interval: ${err.message}`, 'error');
      refresh();
    }
  };

  const setSourceBusy = (id, value) => setBusy((prev) => {
    const next = { ...prev };
    if (value) next[id] = value;
    else delete next[id];
    return next;
  });

  const update = async (source, patch) => {
    setSourceBusy(source.id, 'save');
    try {
      const result = await window.meetmind.calendar.update(source.id, patch);
      if (!result.success) addToast(result.error, 'error');
      else if (patch.enabled) sync(false);
    } finally {
      setSourceBusy(source.id, null);
    }
  };

  const signIn = async (source) => {
    setSourceBusy(source.id, 'signin');
    try {
      const result = await window.meetmind.calendar.reconnect(source.id);
      if (result.success) sync(true);
      else if (!result.cancelled) addToast(result.error, 'error');
    } finally {
      setSourceBusy(source.id, null);
    }
  };

  const remove = async (source) => {
    const ok = await confirm({
      title: `Remove ${source.name}?`,
      message: source.type === 'google'
        ? 'Its meetings leave the Dashboard and MeetMind forgets the sign-in. You can add the account again at any time.'
        : 'Its meetings leave the Dashboard and MeetMind forgets the link. You can add it again at any time.',
      confirmLabel: 'Remove',
      destructive: true,
    });
    if (!ok) return;
    setRemoving(source.id);
    await new Promise((resolve) => setTimeout(resolve, REMOVE_ANIMATION_MS));
    const result = await window.meetmind.calendar.remove(source.id);
    setRemoving(null);
    if (!result.success) addToast(result.error, 'error');
  };

  const onAdded = (result) => {
    const count = result.eventCount;
    if (result.existing) addToast(`${result.source.name} was already added, so it was signed in again.`);
    else if (count != null) addToast(`Added ${result.source.name}: ${count === 0 ? 'no upcoming meetings yet' : `${count} upcoming ${count === 1 ? 'meeting' : 'meetings'}`}.`);
    else addToast(`Added ${result.source.name}.`);
    sync(false);
  };

  const { sources, max, syncMinutes, syncIntervals } = data;
  const full = sources.length >= max;
  const googleSource = sources.find((s) => s.type === 'google' && s.clientId);

  return (
    <SettingsGroup
      title="Calendars"
      description={`Show upcoming meetings on the Dashboard and get a prompt to record when one starts. Add up to ${max}, from any calendar app.`}
      icon={<CalendarDays size={20} strokeWidth={1.75} className="text-ink" />}
      aside={
        sources.length > 0 && (
          <div className="flex items-center gap-8">
            <span className="pill-quiet tabular" aria-label={`${sources.length} of ${max} calendars`}>{sources.length} / {max}</span>
            <IconButton label="Sync calendars now" onClick={() => sync(true)} disabled={syncing}>
              <RefreshCw size={16} strokeWidth={1.75} className={syncing ? 'spinner' : ''} />
            </IconButton>
          </div>
        )
      }
    >
      {loaded && sources.length === 0 && (
        <div className="tile p-24">
          <p className="text-body-sm font-medium text-ink">No calendars yet</p>
          <p className="text-caption text-graphite mt-4">
            Paste a calendar link from Google, Outlook, Apple iCloud or any app that offers one. No accounts or API keys needed.
          </p>
        </div>
      )}

      {sources.length > 0 && (
        <ul className="space-y-8" aria-label="Your calendars">
          {sources.map((source) => (
            <CalendarRow
              key={source.id}
              source={source}
              busy={busy[source.id]}
              removing={removing === source.id}
              now={now}
              onToggle={(enabled) => update(source, { enabled })}
              onReminders={() => update(source, { reminders: !source.reminders })}
              onRename={() => setEditing({ source, field: 'name' })}
              onEditLink={() => setEditing({ source, field: 'url' })}
              onSignIn={() => signIn(source)}
              onCancelSignIn={() => window.meetmind.calendar.cancelAuth()}
              onRemove={() => remove(source)}
            />
          ))}
        </ul>
      )}

      {sources.length > 0 && syncIntervals.length > 0 && (
        <SettingRow
          label="Sync every"
          description={`MeetMind checks your calendars for changes ${syncPhrase(syncMinutes)}. Use the refresh button to sync at once.`}
        >
          <SegmentedControl
            label="Sync every"
            role="radiogroup"
            size="sm"
            options={syncIntervals.map((m) => ({ value: m, label: syncLabel(m) }))}
            value={syncMinutes}
            onChange={changeSyncInterval}
          />
        </SettingRow>
      )}

      <div className="flex flex-wrap items-center gap-16">
        <button type="button" onClick={() => setAdding(true)} disabled={full || !loaded} className="btn-ink btn-sm">
          <Plus size={14} strokeWidth={2} aria-hidden="true" />
          Add calendar
        </button>
        {full && <span className="hint">That’s the maximum of {max}. Remove one to add another.</span>}
      </div>

      <AddCalendarDialog
        open={adding}
        onClose={() => setAdding(false)}
        onAdded={onAdded}
        syncPhrase={syncPhrase(syncMinutes)}
        googleClient={googleSource ? { clientId: googleSource.clientId, name: googleSource.name } : null}
      />
      <EditCalendarDialog
        source={editing?.source}
        field={editing?.field}
        onClose={() => setEditing(null)}
        onSaved={() => sync(false)}
      />
    </SettingsGroup>
  );
}
