import React from 'react';
import { Bell, BellOff, ExternalLink, Link2, LogIn, MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import GoogleCalendarIcon from '../../GoogleCalendarIcon.jsx';
import { AvatarTile, IconButton, StatusDot, Switch, Menu, MenuItem } from '../../ui/index.jsx';
import { openExternal } from '../SettingsParts.jsx';

const MENU_ICON = { size: 14, strokeWidth: 1.75, 'aria-hidden': true };

function syncedAgo(at, now) {
  const minutes = Math.floor((now - at) / 60_000);
  if (minutes < 1) return 'Synced just now';
  if (minutes < 60) return `Synced ${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  return `Synced ${hours} h ago`;
}

function StatusLine({ source, busy, now }) {
  const { status = {} } = source;
  if (busy === 'signin') {
    return (
      <>
        <StatusDot tone="busy" />
        Waiting for you to sign in in your browser…
      </>
    );
  }
  if (status.state === 'off') {
    return (
      <>
        <StatusDot tone="neutral" />
        Off: hidden from the Dashboard and no reminders
      </>
    );
  }
  if (status.state === 'error') {
    return (
      <span className="inline-flex items-start gap-8 text-signal" role="alert">
        <StatusDot tone="error" className="mt-8" />
        {status.error}
      </span>
    );
  }
  if (status.state === 'ok') {
    const count = status.eventCount ?? 0;
    return (
      <>
        <StatusDot tone="ok" />
        {syncedAgo(status.lastSyncAt, now)} · {count === 0 ? 'no upcoming meetings' : `${count} upcoming`}
      </>
    );
  }
  return (
    <>
      <StatusDot tone="busy" />
      Syncing…
    </>
  );
}

/** One calendar source: what it is, how its sync is going, and its on/off switch and menu. */
export default function CalendarRow({ source, busy, removing, now, onToggle, onReminders, onRename, onEditLink, onSignIn, onCancelSignIn, onRemove }) {
  const isGoogle = source.type === 'google';
  const { status = {} } = source;
  const needsSignIn = isGoogle && status.needsSignIn && source.enabled;

  return (
    <li className={`tile p-16 ${removing ? 'card-deleting' : ''}`}>
      <div className="flex items-start gap-16">
        <AvatarTile size={40}>
          {isGoogle ? <GoogleCalendarIcon size={20} /> : <Link2 size={20} strokeWidth={1.75} aria-hidden="true" />}
        </AvatarTile>

        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-8 min-w-0">
            <span className="text-body-sm font-medium text-ink truncate">{source.name}</span>
            <span className="pill-quiet">{isGoogle ? 'Google account' : 'ICS link'}</span>
            {!source.reminders && source.enabled && (
              <span className="pill-quiet">
                <BellOff {...MENU_ICON} />
                No reminders
              </span>
            )}
          </div>
          {source.detail && source.detail !== source.name && <p className="text-caption text-graphite truncate mt-4">{source.detail}</p>}
          <p className="flex items-center gap-8 text-caption text-graphite mt-8">
            <StatusLine source={source} busy={busy} now={now} />
          </p>

          {(needsSignIn || status.actionUrl || busy === 'signin') && source.enabled && (
            <div className="flex flex-wrap items-center gap-8 mt-16">
              {busy === 'signin' ? (
                <button type="button" onClick={onCancelSignIn} className="btn-ghost btn-sm">Cancel sign-in</button>
              ) : needsSignIn ? (
                <button type="button" onClick={onSignIn} className="btn-ink btn-sm">
                  <LogIn size={14} strokeWidth={1.75} aria-hidden="true" />
                  Sign in with Google
                </button>
              ) : null}
              {status.actionUrl && busy !== 'signin' && (
                <button type="button" onClick={() => openExternal(status.actionUrl)} className="btn-ghost btn-sm">
                  <ExternalLink size={14} strokeWidth={1.75} aria-hidden="true" />
                  {status.actionLabel || 'Open'}
                </button>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center gap-8 flex-shrink-0">
          <Switch
            id={`calendar-${source.id}`}
            label={`Use ${source.name}`}
            checked={source.enabled}
            disabled={!!busy}
            onChange={onToggle}
          />
          <Menu
            label={`${source.name} options`}
            trigger={({ open: _open, ...props }) => (
              <IconButton label={`${source.name} options`} disabled={!!busy} {...props}>
                <MoreHorizontal size={18} strokeWidth={1.75} />
              </IconButton>
            )}
          >
            <MenuItem onSelect={onRename} icon={<Pencil {...MENU_ICON} />}>Rename…</MenuItem>
            {isGoogle ? (
              <MenuItem onSelect={onSignIn} icon={<LogIn {...MENU_ICON} />}>Sign in again</MenuItem>
            ) : (
              <MenuItem onSelect={onEditLink} icon={<Link2 {...MENU_ICON} />}>Change link…</MenuItem>
            )}
            <MenuItem onSelect={onReminders} icon={source.reminders ? <BellOff {...MENU_ICON} /> : <Bell {...MENU_ICON} />}>
              {source.reminders ? 'Turn off reminders' : 'Turn on reminders'}
            </MenuItem>
            <MenuItem onSelect={onRemove} icon={<Trash2 {...MENU_ICON} />}>Remove…</MenuItem>
          </Menu>
        </div>
      </div>
    </li>
  );
}
