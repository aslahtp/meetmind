// Launch at login (the `autoLaunch` setting).
//
// On Windows Electron writes a value under HKCU\Software\Microsoft\Windows\CurrentVersion\Run. Ours
// is named "MeetMind" and passes --hidden, so a login launch starts in the tray. Electron's
// `openAtLogin` read-back only looks for a value named after the AppUserModelId and ignores a
// custom `name`, so it always reported false here; the state is read from `launchItems` instead,
// which lists only the Run entries that start this exe, with whether Task Manager or
// Settings › Apps › Startup has disabled them.
//
// Electron has no login items on Linux, so there it is an XDG autostart entry,
// ~/.config/autostart/meetmind.desktop, that starts the app with --hidden. An AppImage runs from a
// temporary mount, so the entry points at the AppImage file itself ($APPIMAGE). Desktops disable
// an entry without deleting it (Hidden=true, or GNOME's X-GNOME-Autostart-enabled=false), which
// reads like a Run entry disabled in Task Manager.
//
// No electron import: main passes `app` in, which keeps this unit-testable. `isDev` (any unpackaged
// run) writes nothing, since the exe would be the bare dev electron binary.

const path = require('path');

const AUTO_LAUNCH_NAME = 'MeetMind';
const HIDDEN_ARG = '--hidden';
const AUTOSTART_FILE = 'meetmind.desktop';

// Exec= quoting from the Desktop Entry spec: double quotes, with " ` $ \ escaped.
function quoteExec(arg) {
  return `"${String(arg).replace(/(["`$\\])/g, '\\$1')}"`;
}

/** The autostart entry that launches `execPath` hidden at login. */
function buildAutostartEntry(execPath) {
  return [
    '[Desktop Entry]',
    'Type=Application',
    `Name=${AUTO_LAUNCH_NAME}`,
    'Comment=Open MeetMind in the tray at login',
    `Exec=${quoteExec(execPath)} ${HIDDEN_ARG}`,
    'Icon=meetmind',
    'Terminal=false',
    'X-GNOME-Autostart-enabled=true',
    '',
  ].join('\n');
}

/** Whether an autostart entry's text leaves it enabled (no Hidden=true, not turned off in GNOME). */
function autostartEnabled(text) {
  return !/^Hidden\s*=\s*true\s*$/mi.test(text) && !/^X-GNOME-Autostart-enabled\s*=\s*false\s*$/mi.test(text);
}

// Reads and writes the XDG autostart entry. `fs`, `env` and `execPath` come in for tests.
function linuxAutostart({ fs, env, execPath, homedir }) {
  const dir = path.posix.join(env.XDG_CONFIG_HOME || path.posix.join(homedir, '.config'), 'autostart');
  const file = path.posix.join(dir, AUTOSTART_FILE);
  const target = env.APPIMAGE || execPath;
  return {
    file,
    // null when there is no entry, else { enabled }.
    read() {
      try {
        return { enabled: autostartEnabled(fs.readFileSync(file, 'utf8')) };
      } catch (err) {
        if (err.code === 'ENOENT') return null;
        throw err;
      }
    },
    write(enabled) {
      if (enabled) {
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(file, buildAutostartEntry(target));
      } else {
        fs.rmSync(file, { force: true });
      }
    },
  };
}

// Once our entry exists Windows is the source of truth, since the user can disable it outside
// MeetMind; without one, the saved setting decides.
function resolveStartupState(configured, item) {
  if (item) return item.enabled !== false;
  return !!configured;
}

function createAutoLaunch({ app, platform = process.platform, isDev = false, logger = console, linux = null }) {
  if (platform === 'linux') {
    return createLinuxAutoLaunch({
      isDev,
      logger,
      autostart: linuxAutostart(linux || {
        fs: require('fs'),
        env: process.env,
        execPath: process.execPath,
        homedir: require('os').homedir(),
      }),
    });
  }
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

// Linux: same contract as above over the autostart entry. Like Windows, once the entry exists it
// is the source of truth, since the desktop's startup-apps settings can disable it.
function createLinuxAutoLaunch({ isDev, logger, autostart }) {
  function getStatus() {
    if (isDev) return { openAtLogin: false, isDev: true };
    try {
      const entry = autostart.read();
      return { openAtLogin: resolveStartupState(false, entry), disabledInSystem: !!entry && entry.enabled === false };
    } catch (err) {
      logger.error('Failed to read auto-launch status', err);
      return { openAtLogin: false, error: err.message };
    }
  }

  function set(enabled) {
    if (isDev) {
      logger.info('Skipping autostart entry in an unpackaged app', { enabled });
      return;
    }
    try {
      autostart.write(!!enabled);
      logger.info('Auto-launch updated', { enabled: !!enabled, file: autostart.file });
    } catch (err) {
      logger.error('Failed to update auto-launch', err);
    }
  }

  function sync(configured) {
    if (isDev) {
      logger.info('Skipping autostart entry in an unpackaged app', { enabled: configured });
      return !!configured;
    }
    try {
      const entry = autostart.read();
      const enabled = resolveStartupState(configured, entry);
      // Rewriting an enabled entry refreshes its path after the AppImage is moved or updated.
      if (enabled) autostart.write(true);
      logger.info('Auto-launch synced', {
        enabled,
        configured: !!configured,
        entry: entry ? (entry.enabled ? 'enabled' : 'disabled in startup settings') : 'none',
      });
      return enabled;
    } catch (err) {
      logger.error('Failed to sync auto-launch', err);
      return !!configured;
    }
  }

  return { getStatus, set, sync };
}

module.exports = {
  AUTO_LAUNCH_NAME,
  HIDDEN_ARG,
  resolveStartupState,
  buildAutostartEntry,
  autostartEnabled,
  linuxAutostart,
  createAutoLaunch,
};
