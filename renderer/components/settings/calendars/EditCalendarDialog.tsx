import React, { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Dialog, PasswordField, StatusDot, TextField } from '../../ui/index';
import { errorMessage } from '../../../lib/errors';
import type { CalendarSource } from '@shared';

/**
 * Rename a calendar (`field` 'name') or replace an ICS calendar's link (`field` 'url'). A new
 * link is checked before it's saved; the old one keeps working if the new one doesn't.
 */
interface EditCalendarDialogProps {
  /** The calendar being edited; the dialog is closed while this is undefined. */
  source?: CalendarSource;
  field?: 'name' | 'url';
  onClose: () => void;
  onSaved: () => void;
}

export default function EditCalendarDialog({ source, field, onClose, onSaved }: EditCalendarDialogProps) {
  const open = !!source;
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!source) return;
    setValue(field === 'name' ? source.name : '');
    setBusy(false);
    setError(null);
  }, [source, field]);

  const save = async () => {
    if (!source || !field) return;
    setBusy(true);
    setError(null);
    try {
      const result = await window.meetmind.calendar.update(source.id, { [field]: value });
      if (result.success) {
        onSaved();
        onClose();
      } else {
        setError(result.error || 'Couldn’t save the change.');
      }
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const isUrl = field === 'url';
  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="sm"
      dismissible={!busy}
      title={isUrl ? 'Change calendar link' : 'Rename calendar'}
      description={isUrl ? `Paste the new ICS link for ${source?.name}. MeetMind checks it before saving.` : undefined}
      footer={
        <>
          <button type="button" onClick={onClose} disabled={busy} className="btn-ghost btn-sm">Cancel</button>
          <button type="button" onClick={save} disabled={busy || !value.trim()} className="btn-ink btn-sm">
            {busy && <Loader2 size={14} strokeWidth={2} className="spinner" aria-hidden="true" />}
            {busy ? (isUrl ? 'Checking link…' : 'Saving…') : 'Save'}
          </button>
        </>
      }
    >
      <form onSubmit={(e) => { e.preventDefault(); if (value.trim() && !busy) save(); }}>
        {isUrl ? (
          <PasswordField
            id="calendar-edit-url"
            label="Calendar link"
            value={value}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setValue(e.target.value)}
            placeholder="https://… or webcal://…"
            disabled={busy}
          />
        ) : (
          <TextField
            id="calendar-edit-name"
            label="Name"
            value={value}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setValue(e.target.value)}
            maxLength={60}
            disabled={busy}
          />
        )}
        <button type="submit" hidden aria-hidden="true" tabIndex={-1} />
      </form>
      {error && (
        <p className="flex items-start gap-8 text-caption text-signal mt-16" role="alert">
          <StatusDot tone="error" className="mt-8" />
          {error}
        </p>
      )}
    </Dialog>
  );
}
