// "Keep recordings" choices for Settings › Storage. Same values as RETENTION_DAYS in
// electron/services/storage-rules.js (tests/storageRules.test.js checks they match).
import { formatBytes, plural } from './format.js';

export const RETENTION_OPTIONS = [
  { value: 0, label: 'Forever' },
  { value: 1, label: '1 day' },
  { value: 7, label: '7 days' },
  { value: 30, label: '30 days' },
  { value: 90, label: '90 days' },
  { value: 365, label: '1 year' },
];

// 30 → "30 days", 365 → "1 year"
export function retentionPeriod(days) {
  return RETENTION_OPTIONS.find((o) => o.value === days)?.label || plural(days, 'day');
}

// (3, 440401920) → "3 recordings (420 MB)"
export function describeRecordings(count, bytes) {
  return `${plural(count, 'recording')} (${formatBytes(bytes)})`;
}

// Toast for a cleanup or "Delete all": { message, type } for addToast.
export function deletionToast(result) {
  if (!result?.success) {
    return { message: `Couldn’t delete recordings: ${result?.error || 'unknown error'}`, type: 'error' };
  }
  const parts = [];
  if (result.count > 0) parts.push(`Deleted ${plural(result.count, 'recording')}, freed ${formatBytes(result.bytes)}.`);
  if (result.failed > 0) parts.push(`${plural(result.failed, 'recording')} couldn’t be deleted because the file is in use.`);
  if (result.skipped > 0) parts.push(`Kept ${plural(result.skipped, 'recording')} that MeetMind is recording or processing.`);
  if (parts.length === 0) return { message: 'No recordings to delete.', type: 'info' };
  return { message: parts.join(' '), type: result.failed > 0 ? 'warning' : 'success' };
}
