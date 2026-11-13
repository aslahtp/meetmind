import type { Notes, Session } from '@shared';
import { formatDate, formatTime } from '../../lib/format';

// "Thu, Sep 25, 2026 · 2:30 PM · 42m 13s · 3 attendees" — shared by the meeting page header
// and the PDF export. Kept out of NoteHeader.tsx so that file exports only components
// (React Fast Refresh can then hot-swap it).
export function metaText(session: Pick<Session, 'started_at'>, notes: Notes | null | undefined, durationLabel: string | null | undefined) {
  const attendees = notes?.attendees || [];
  const parts = [
    session.started_at && formatDate(session.started_at),
    session.started_at && formatTime(session.started_at),
    notes?.duration || durationLabel,
    attendees.length > 0 && `${attendees.length} attendee${attendees.length !== 1 ? 's' : ''}`,
  ].filter(Boolean);
  return parts.join(' · ');
}
