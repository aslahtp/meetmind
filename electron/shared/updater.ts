// Auto-update state. Source: getUpdaterState() in electron/services/updater.ts.

export type UpdaterStatus =
  | 'idle'
  | 'checking'
  | 'available'
  | 'not-available'
  | 'downloading'
  | 'downloaded'
  | 'error';

export interface UpdateInfo {
  version: string;
  releaseDate?: string;
  releaseNotes?: unknown;
  [key: string]: unknown;
}

export interface UpdateDownloadProgress {
  percent: number;
  bytesPerSecond: number;
  transferred: number;
  total: number;
}

/** After an update, whether the bundled FFmpeg/FFprobe are still there. */
export interface PostUpdateCheck {
  version: string;
  ok: boolean;
  missing: string[];
  checkedAt: string;
}

/** `updater:get-status` and the `updater:status` event. */
export interface UpdaterState {
  status: UpdaterStatus;
  currentVersion: string;
  updateInfo: UpdateInfo | null;
  downloadProgress: UpdateDownloadProgress;
  /** ISO timestamp of the last check. */
  lastCheckTime: string | null;
  errorMessage: string | null;
  /** What the last error interrupted. */
  errorPhase: 'check' | 'download' | null;
  consecutiveFailures: number;
  postUpdateCheck: PostUpdateCheck | null;
  isPackaged: boolean;
  canSelfUpdate: boolean;
  autoInstall: boolean;
  releaseUrl: string;
}

/** What `updater:check` / `download` / `install` resolve with (the exact fields depend on the outcome). */
export interface UpdaterActionResult {
  success: boolean;
  error?: string;
  reason?: string;
  status?: UpdaterStatus;
  alreadyDownloading?: boolean;
  openedReleasePage?: boolean;
  [key: string]: unknown;
}
