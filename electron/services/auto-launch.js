// Launch at login (the `autoLaunch` setting).
//
// On Windows Electron writes a value under HKCU\Software\Microsoft\Windows\CurrentVersion\Run. Ours
// is named "MeetMind" and passes --hidden, so a login launch starts in the tray. Electron's
// `openAtLogin` read-back only looks for a value named after the AppUserModelId and ignores a
// custom `name`, so it always reported false here; the state is read from `launchItems` instead,
// which lists only the Run entries that start this exe, with whether Task Manager or
// Settings › Apps › Startup has disabled them.
//
// No electron import: main passes `app` in, which keeps this unit-testable. `isDev` (any unpackaged
// run) writes nothing, since the exe would be the bare dev electron binary.

const AUTO_LAUNCH_NAME = 'MeetMind';
const HIDDEN_ARG = '--hidden';

// Once our entry exists Windows is the source of truth, since the user can disable it outside
// MeetMind; without one, the saved setting decides.
function resolveStartupState(configured, item) {
  if (item) return item.enabled !== false;
  return !!configured;
}

function createAutoLaunch({ app, platform = process.platform, isDev = false, logger = console }) {
  const isWindows = platform === 'win32';

  const read = () => app.getLoginItemSettings();
  const ourItem = (settings) => (settings.launchItems || []).find((i) => i.name === AUTO_LAUNCH_NAME) || null;

  function write(enabled) {
    if (isWindows) {
      app.setLoginItemSettings({ openAtLogin: enabled, name: AUTO_LAUNCH_NAME, args: [HIDDEN_ARG] });
    } else {
      app.setLoginItemSettings({ openAtLogin: enabled });
    }
  }

  // Older builds registered this exe under other names (the AppUserModelId). `launchItems` only
  // lists entries that start this exe, so any per-user one not named ours is a leftover.
  function removeStrays(settings) {
    for (const item of settings.launchItems || []) {
      if (item.name === AUTO_LAUNCH_NAME || item.scope !== 'user') continue;
      app.setLoginItemSettings({ openAtLogin: false, name: item.name });
      logger.info('Removed stale launch-at-login entry', { name: item.name });
    }
  }

  // What Settings shows: { openAtLogin }, plus isDev or error when the OS state can't be used.
  function getStatus() {
    if (isDev) return { openAtLogin: false, isDev: true };
    try {
      const settings = read();
      if (!isWindows) return { openAtLogin: !!settings.openAtLogin };
      const item = ourItem(settings);
      return { openAtLogin: resolveStartupState(false, item), disabledInSystem: !!item && item.enabled === false };
    } catch (err) {
      logger.error('Failed to read auto-launch status', err);
      return { openAtLogin: false, error: err.message };
    }
  }

  // Turns launch at login on or off from Settings. Turning it on also re-enables an entry
  // disabled in Task Manager, since the user just asked for it.
  function set(enabled) {
    if (isDev) {
      logger.info('Skipping setLoginItemSettings in an unpackaged app', { enabled });
      return;
    }
    try {
      write(!!enabled);
      if (isWindows) removeStrays(read());
      logger.info('Auto-launch updated', { enabled: !!enabled });
    } catch (err) {
      logger.error('Failed to update auto-launch', err);
    }
  }

  // Run once at startup. Returns the effective setting, for main to store.
  function sync(configured) {
    if (isDev) {
      logger.info('Skipping setLoginItemSettings in an unpackaged app', { enabled: configured });
      return !!configured;
    }
    try {
      if (!isWindows) {
        write(!!configured);
        return !!configured;
      }
      const settings = read();
      removeStrays(settings);
      const item = ourItem(settings);
      const enabled = resolveStartupState(configured, item);
      // Rewriting an enabled entry refreshes its path and arguments after an update or reinstall.
      if (enabled) write(true);
      logger.info('Auto-launch synced', {
        enabled,
        configured: !!configured,
        entry: item ? (item.enabled === false ? 'disabled in Windows' : 'enabled') : 'none',
      });
      return enabled;
    } catch (err) {
      logger.error('Failed to sync auto-launch', err);
      return !!configured;
    }
  }

  return { getStatus, set, sync };
}

module.exports = { AUTO_LAUNCH_NAME, HIDDEN_ARG, resolveStartupState, createAutoLaunch };
