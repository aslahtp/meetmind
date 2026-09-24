import React, { useState, useEffect, useRef } from 'react';
import { Loader2, RefreshCw, RotateCcw, Download, ArrowUpCircle } from 'lucide-react';
import { StatusDot, ProgressBar } from '../ui/index.jsx';
import { SettingsGroup, ExternalLink } from './SettingsParts.jsx';

const BINARIES = [
  { key: 'ffmpeg', label: 'ffmpeg', desc: 'Audio capture & conversion' },
  { key: 'ffprobe', label: 'ffprobe', desc: 'Media duration detection' },
];

const INSTALL_STAGE_HINT = {
  download: 'Downloading from gyan.dev (~80 MB)…',
  extract: 'Extracting archive…',
  copy: 'Installing to app directory…',
};

function StatusLine({ tone, children, className = '' }) {
  return (
    <p className={`flex items-start gap-8 text-caption ${tone === 'error' ? 'text-signal' : 'text-ink'} ${className}`}>
      <StatusDot tone={tone} className="mt-4" />
      <span>{children}</span>
    </p>
  );
}

export default function SystemSection({ active }) {
  const [appVersion, setAppVersion] = useState(typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '');
  const [updaterStatus, setUpdaterStatus] = useState(null);
  const [checkingUpdates, setCheckingUpdates] = useState(false);
  const [downloadingUpdate, setDownloadingUpdate] = useState(false);
  const [ffmpegStatus, setFfmpegStatus] = useState(null); // null | { ffmpeg, ffprobe }
  const [checkingFfmpeg, setCheckingFfmpeg] = useState(false);
  const [installingFfmpeg, setInstallingFfmpeg] = useState(false);
  const [ffmpegInstallProgress, setFfmpegInstallProgress] = useState(null); // { stage, percent, message }
  const autoCheckedRef = useRef(false);

  useEffect(() => {
    async function load() {
      if (!window.meetmind) return;
      if (window.meetmind.app?.getVersion) {
        try {
          const v = await window.meetmind.app.getVersion();
          if (v) setAppVersion(v);
        } catch {}
      }
      if (window.meetmind.updater) {
        try {
          setUpdaterStatus(await window.meetmind.updater.getStatus());
        } catch {}
      }
    }
    load();
  }, []);

  // Live updater state (checking/downloading/downloaded/error) pushed from the main process,
  // so progress and status reflect background checks too — not just ones this screen triggered.
  useEffect(() => {
    if (!window.meetmind?.on) return;
    const unsubscribe = window.meetmind.on('updater:status', (status) => {
      setUpdaterStatus(status);
      if (status?.status !== 'checking') setCheckingUpdates(false);
      if (status?.status !== 'downloading') setDownloadingUpdate(false);
    });
    return () => { if (typeof unsubscribe === 'function') unsubscribe(); };
  }, []);

  useEffect(() => {
    if (!window.meetmind?.ffmpeg?.onProgress) return;
    const unsub = window.meetmind.ffmpeg.onProgress((data) => {
      setFfmpegInstallProgress(data);
    });
    return () => unsub && unsub();
  }, []);

  const handleCheckFfmpeg = async () => {
    if (!window.meetmind?.ffmpeg) return;
    setCheckingFfmpeg(true);
    setFfmpegStatus(null);
    try {
      const result = await window.meetmind.ffmpeg.check();
      setFfmpegStatus(result);
    } catch (err) {
      setFfmpegStatus({ ffmpeg: { found: false }, ffprobe: { found: false }, error: err.message });
    } finally {
      setCheckingFfmpeg(false);
    }
  };

  // Check FFmpeg the first time the System tab is shown, so status is visible without a click.
  useEffect(() => {
    if (active && !autoCheckedRef.current) {
      autoCheckedRef.current = true;
      handleCheckFfmpeg();
    }
  }, [active]);

  const handleInstallFfmpeg = async () => {
    if (!window.meetmind?.ffmpeg || installingFfmpeg) return;
    setInstallingFfmpeg(true);
    setFfmpegInstallProgress({ stage: 'download', percent: 0, message: 'Preparing…' });
    try {
      const result = await window.meetmind.ffmpeg.install();
      if (result.success) {
        // Re-check status after successful install
        const checked = await window.meetmind.ffmpeg.check();
        setFfmpegStatus(checked);
      }
    } catch (err) {
      setFfmpegInstallProgress({ stage: 'error', percent: 0, message: err.message });
    } finally {
      setInstallingFfmpeg(false);
    }
  };

  const handleCheckUpdates = async () => {
    if (!window.meetmind?.updater) return;
    setCheckingUpdates(true);
    try {
      // Result state is picked up via the live 'updater:status' subscription; this call
      // just kicks the check off (and never triggers a download — that's a separate step).
      await window.meetmind.updater.check();
    } finally {
      setCheckingUpdates(false);
    }
  };

  const handleDownloadUpdate = async () => {
    if (!window.meetmind?.updater) return;
    setDownloadingUpdate(true);
    try {
      const result = await window.meetmind.updater.download();
      if (result && result.success === false) {
        setUpdaterStatus((prev) => ({ ...prev, status: 'error', errorMessage: result.error }));
      }
    } finally {
      setDownloadingUpdate(false);
    }
  };

  const missingBinaries = ffmpegStatus && (!ffmpegStatus.ffmpeg?.found || !ffmpegStatus.ffprobe?.found);
  const progress = updaterStatus?.downloadProgress;

  return (
    <div className="space-y-24">
      {/* ── FFmpeg ─────────────────────────────────────────────────────────── */}
      <SettingsGroup
        title="FFmpeg & FFprobe"
        description="Required for audio capture, conversion, duration detection and system audio mixing."
        aside={
          <button type="button" onClick={handleCheckFfmpeg} disabled={checkingFfmpeg} className="btn-ghost btn-sm">
            {checkingFfmpeg ? (
              <>
                <Loader2 size={14} strokeWidth={2} className="spinner" />
                Checking…
              </>
            ) : (
              <>
                <RefreshCw size={14} strokeWidth={1.75} />
                Check status
              </>
            )}
          </button>
        }
      >
        {!ffmpegStatus && !checkingFfmpeg && (
          <p className="hint">Check status to verify that FFmpeg is installed.</p>
        )}

        {ffmpegStatus && (
          <ul className="space-y-8">
            {BINARIES.map(({ key, label, desc }) => {
              const stat = ffmpegStatus[key];
              return (
                <li key={key} className="tile px-16 py-8">
                  <div className="flex items-center justify-between gap-16">
                    <div className="flex items-center gap-8 min-w-0">
                      <StatusDot tone={stat?.found ? 'ok' : 'error'} />
                      <span className="text-body-sm font-medium text-ink">{label}</span>
                      <span className="text-caption text-graphite truncate">{desc}</span>
                    </div>
                    <span className="text-caption text-graphite tabular flex-shrink-0">
                      {stat?.found
                        ? `${stat.version && stat.version !== 'unknown' ? `${stat.version} ` : ''}${stat.source === 'bundled' ? '(bundled)' : '(system)'}`
                        : 'Not found'}
                    </span>
                  </div>
                  {stat?.found && stat.path && (
                    <p className="font-mono text-caption text-graphite truncate mt-4" title={stat.path}>
                      {stat.path}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {missingBinaries && (
          <div className="space-y-24">
            <StatusLine tone="error">One or more binaries are missing — audio features may not work.</StatusLine>

            {installingFfmpeg || ffmpegInstallProgress ? (
              <div className="tile p-16 space-y-16">
                {ffmpegInstallProgress?.stage === 'error' ? (
                  <>
                    <StatusLine tone="error">Install failed</StatusLine>
                    <p className="code-box">{ffmpegInstallProgress.message}</p>
                    <button
                      type="button"
                      onClick={() => { setFfmpegInstallProgress(null); handleInstallFfmpeg(); }}
                      className="btn-ghost btn-sm"
                    >
                      <RotateCcw size={14} strokeWidth={1.75} />
                      Retry
                    </button>
                  </>
                ) : ffmpegInstallProgress?.stage === 'done' ? (
                  <StatusLine tone="ok">{ffmpegInstallProgress.message}</StatusLine>
                ) : (
                  <>
                    <div className="flex items-center justify-between gap-16">
                      <p className="text-caption text-ink">{ffmpegInstallProgress?.message || 'Preparing…'}</p>
                      <span className="text-caption text-graphite tabular">{ffmpegInstallProgress?.percent ?? 0}%</span>
                    </div>
                    <ProgressBar value={ffmpegInstallProgress?.percent ?? 0} label="FFmpeg install progress" />
                    {INSTALL_STAGE_HINT[ffmpegInstallProgress?.stage] && (
                      <p className="hint">{INSTALL_STAGE_HINT[ffmpegInstallProgress.stage]}</p>
                    )}
                  </>
                )}
              </div>
            ) : (
              <div className="space-y-24">
                <div>
                  <p className="text-body-sm font-medium text-ink">Install automatically</p>
                  <p className="hint mt-4">
                    Downloads ffmpeg &amp; ffprobe from gyan.dev (~80 MB) and installs them into the app directory.
                  </p>
                  <button type="button" onClick={handleInstallFfmpeg} className="btn-ink btn-sm mt-16">
                    <Download size={14} strokeWidth={1.75} />
                    Download &amp; install FFmpeg
                  </button>
                </div>

                <div className="rule pt-24">
                  <p className="text-body-sm font-medium text-ink">Or install with Windows Package Manager</p>
                  <code className="code-box block select-all mt-8">winget install Gyan.FFmpeg</code>
                  <p className="hint mt-8">Run in PowerShell or Command Prompt, then restart MeetMind and check again.</p>
                </div>

                <ExternalLink href="https://ffmpeg.org/download.html">Official FFmpeg download page</ExternalLink>
              </div>
            )}
          </div>
        )}
      </SettingsGroup>

      {/* ── Application updates ───────────────────────────────────────────── */}
      <SettingsGroup
        title="Application updates"
        icon={<ArrowUpCircle size={20} strokeWidth={1.75} className="text-ink" />}
      >
        {/* Post-update integrity warning — surfaces a broken release (e.g. missing bundled
            FFmpeg) right after it installs, instead of failing silently mid-recording. */}
        {updaterStatus?.postUpdateCheck && !updaterStatus.postUpdateCheck.ok && (
          <div className="tile border-signal p-16 space-y-8">
            <StatusLine tone="error">
              <span className="font-medium">
                Update to v{updaterStatus.postUpdateCheck.version} is missing required files
              </span>
            </StatusLine>
            <p className="hint">
              {updaterStatus.postUpdateCheck.missing.join(', ')} could not be found after updating. Audio recording won&apos;t work until this is repaired.
            </p>
            <button
              type="button"
              onClick={handleInstallFfmpeg}
              disabled={installingFfmpeg}
              className="btn-ink btn-sm"
            >
              <RotateCcw size={14} strokeWidth={1.75} />
              Repair now
            </button>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-16">
          <div>
            <p className="text-body-sm text-ink">
              Current version <span className="font-medium tabular">v{appVersion}</span>
            </p>
            {updaterStatus?.updateInfo?.version && updaterStatus.status !== 'not-available' && (
              <p className="text-caption text-graphite mt-4">
                Latest available <span className="tabular">v{updaterStatus.updateInfo.version}</span>
              </p>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-8">
            <button
              type="button"
              onClick={handleCheckUpdates}
              disabled={checkingUpdates || downloadingUpdate}
              className="btn-ghost btn-sm"
            >
              {checkingUpdates ? (
                <>
                  <Loader2 size={14} strokeWidth={2} className="spinner" />
                  Checking…
                </>
              ) : (
                <>
                  <RefreshCw size={14} strokeWidth={1.75} />
                  Check for updates
                </>
              )}
            </button>

            {updaterStatus?.status === 'available' && (
              <button type="button" onClick={handleDownloadUpdate} disabled={downloadingUpdate} className="btn-ink btn-sm">
                <Download size={14} strokeWidth={1.75} />
                Download update
              </button>
            )}

            {updaterStatus?.status === 'downloaded' && (
              <button type="button" onClick={() => window.meetmind.updater?.install()} className="btn-ink btn-sm">
                Restart &amp; install
              </button>
            )}
          </div>
        </div>

        {updaterStatus?.status === 'downloading' && (
          <div className="space-y-8">
            <div className="flex items-center justify-between gap-16">
              <p className="text-caption text-ink">Downloading v{updaterStatus.updateInfo?.version}…</p>
              <span className="text-caption text-graphite tabular">{progress?.percent ?? 0}%</span>
            </div>
            <ProgressBar value={progress?.percent ?? 0} label="Update download progress" />
            {progress?.total > 0 && (
              <p className="hint tabular">
                {(progress.transferred / 1024 / 1024).toFixed(1)} MB / {(progress.total / 1024 / 1024).toFixed(1)} MB
                {progress.bytesPerSecond > 0 && ` · ${(progress.bytesPerSecond / 1024 / 1024).toFixed(1)} MB/s`}
              </p>
            )}
          </div>
        )}

        {updaterStatus?.status === 'downloaded' && (
          <StatusLine tone="ok">v{updaterStatus.updateInfo?.version} downloaded and verified — restart to install.</StatusLine>
        )}

        {updaterStatus?.status === 'not-available' && (
          <StatusLine tone="ok">You are running the latest version of MeetMind.</StatusLine>
        )}

        {updaterStatus?.status === 'error' && updaterStatus?.errorMessage && (
          <StatusLine tone="error">{updaterStatus.errorMessage}</StatusLine>
        )}

        {updaterStatus?.backgroundChecksSuspended && (
          <StatusLine tone="warning">
            Automatic update checks paused after repeated failures — use "Check for updates" to retry.
          </StatusLine>
        )}
      </SettingsGroup>
    </div>
  );
}
