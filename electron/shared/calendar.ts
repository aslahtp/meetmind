// Calendar types. Sources: electron/calendar/{calendar-sources,calendar-events,index,google,ics-parse}.ts.
// Sources hold credentials (ICS links, OAuth secrets), so the renderer only ever sees `CalendarSource`
// (the redacted form from `publicSource()`), never the stored record.

export type CalendarSourceType = 'google' | 'ics';

/** Minutes between syncs: one of SYNC_INTERVALS in calendar-sources.ts. */
export type CalendarSyncMinutes = 1 | 5 | 10 | 15 | 30 | 60;

/** A calendar source as saved in config `calendars` (main process only: it holds credentials). */
export interface StoredCalendarSource {
  id: string;
  type: CalendarSourceType;
  name: string;
  /** Off only when `false`; missing counts as on. */
  enabled?: boolean;
  /** Meeting-starting prompts; off only when `false`. */
  reminders?: boolean;
  /** ICS only: the feed link, which is the credential. */
  url?: string;
  /** Google only: the user's OAuth client, the account's refresh token and email. */
  clientId?: string;
  clientSecret?: string;
  refreshToken?: string;
  email?: string;
}

/** Per-calendar sync state shown in Settings › Integrations › Calendars. */
export interface CalendarSyncStatus {
  state: 'pending' | 'ok' | 'error' | 'off';
  lastSyncAt?: number;
  eventCount?: number;
  error?: string;
  actionUrl?: string;
  actionLabel?: string;
  needsSignIn?: boolean;
}

/** A calendar as the renderer may see it (no URL path, client secret or token). */
export interface CalendarSource {
  id: string;
  type: CalendarSourceType;
  name: string;
  enabled: boolean;
  reminders: boolean;
  /** Google: the account's email. ICS: the feed's host. */
  detail: string;
  /** Google only. */
  clientId?: string;
  /** Google only: whether the account is signed in. */
  signedIn?: boolean;
}

/** `calendar:list` */
export interface CalendarList {
  max: number;
  syncMinutes: CalendarSyncMinutes;
  syncIntervals: CalendarSyncMinutes[];
  sources: Array<CalendarSource & { status: CalendarSyncStatus }>;
}

/** Input of `calendar:add`. */
export type CalendarAddInput =
  | { type: 'ics'; name?: string; url: string }
  | { type: 'google'; name?: string; clientId: string; clientSecret?: string };

/** Input of `calendar:update`: only these fields can change on an existing source. */
export interface CalendarUpdatePatch {
  name?: string;
  enabled?: boolean;
  reminders?: boolean;
  /** ICS sources only. */
  url?: string;
}

/** One event, tagged with the calendar it came from. Times are ISO strings, or `YYYY-MM-DD` when `isAllDay`. */
export interface CalendarEvent {
  id: string;
  /** iCalendar UID; the same meeting has the same one in every calendar. */
  uid: string;
  title: string;
  start: string;
  end: string;
  isAllDay: boolean;
  location: string;
  description: string;
  /** The link to join, or '' when none was found. */
  meetingLink?: string;
  /** Google events only. */
  attendeeCount?: number;
  organizer?: string;
  status?: string;
  sourceId: string;
  sourceName: string;
  sourceType: CalendarSourceType;
  [key: string]: unknown;
}

/** A calendar that failed during `calendar:events`. */
export interface CalendarSyncError {
  sourceId: string;
  name: string;
  message: string;
  actionUrl: string;
  actionLabel: string;
  needsSignIn: boolean;
}

/** `calendar:events` */
export interface CalendarEventsResult {
  events: CalendarEvent[];
  errors: CalendarSyncError[];
}

/** Every `calendar:*` handler except `list` and `cancel-auth` resolves with this instead of throwing. */
export type CalendarOutcome<T = unknown> =
  | ({ success: true } & T)
  | { success: false; error: string; cancelled: boolean };
