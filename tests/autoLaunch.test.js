import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { AUTO_LAUNCH_NAME, HIDDEN_ARG, resolveStartupState, createAutoLaunch } = require('../electron/services/auto-launch.js');

const quietLogger = { info() {}, warn() {}, error() {} };

// A stand-in for Electron's app login-item API on Windows: Run entries for this exe, keyed by
// name. Like Electron, `openAtLogin` only looks at the AppUserModelId-named value, so it never
// sees ours.
function fakeWindowsApp(entries = {}) {
  const run = new Map(Object.entries(entries));
  const calls = [];
  return {
    run,
    calls,
    getLoginItemSettings() {
      return {
        openAtLogin: run.has('com.meetmind.app'),
        launchItems: [...run.entries()].map(([name, e]) => ({ name, path: 'C:\\MeetMind.exe', args: [], scope: 'user', enabled: e.enabled })),
      };
    },
    setLoginItemSettings(opts) {
      calls.push(opts);
      if (opts.openAtLogin) run.set(opts.name, { enabled: opts.enabled !== false, args: opts.args });
      else run.delete(opts.name);
    },
  };
}

const windows = (app) => createAutoLaunch({ app, platform: 'win32', logger: quietLogger });

describe('resolveStartupState', () => {
  it('follows the saved setting when there is no entry', () => {
    expect(resolveStartupState(true, null)).toBe(true);
    expect(resolveStartupState(false, null)).toBe(false);
  });

  it('follows Windows once an entry exists', () => {
    expect(resolveStartupState(false, { enabled: true })).toBe(true);
    expect(resolveStartupState(true, { enabled: false })).toBe(false);
  });
});

describe('createAutoLaunch on Windows', () => {
  it('reports an entry under our name as on, although openAtLogin reads false', () => {
    const app = fakeWindowsApp({ [AUTO_LAUNCH_NAME]: { enabled: true } });
    expect(app.getLoginItemSettings().openAtLogin).toBe(false);
    expect(windows(app).getStatus()).toEqual({ openAtLogin: true, disabledInSystem: false });
  });

  it('reports an entry disabled in Task Manager as off', () => {
    const app = fakeWindowsApp({ [AUTO_LAUNCH_NAME]: { enabled: false } });
    expect(windows(app).getStatus()).toEqual({ openAtLogin: false, disabledInSystem: true });
  });

  it('registers with --hidden when turned on', () => {
    const app = fakeWindowsApp();
    windows(app).set(true);
    expect(app.run.get(AUTO_LAUNCH_NAME)).toEqual({ enabled: true, args: [HIDDEN_ARG] });
  });

  it('removes the entry when turned off', () => {
    const app = fakeWindowsApp({ [AUTO_LAUNCH_NAME]: { enabled: true } });
    windows(app).set(false);
    expect(app.run.has(AUTO_LAUNCH_NAME)).toBe(false);
  });

  it('re-enables an entry disabled in Task Manager when turned on in Settings', () => {
    const app = fakeWindowsApp({ [AUTO_LAUNCH_NAME]: { enabled: false } });
    windows(app).set(true);
    expect(app.run.get(AUTO_LAUNCH_NAME).enabled).toBe(true);
  });

  it('removes entries older builds wrote under other names', () => {
    const app = fakeWindowsApp({ 'com.meetmind.app': { enabled: true }, [AUTO_LAUNCH_NAME]: { enabled: true } });
    windows(app).sync(true);
    expect([...app.run.keys()]).toEqual([AUTO_LAUNCH_NAME]);
  });

  describe('sync at startup', () => {
    it('registers when the setting is on and no entry exists', () => {
      const app = fakeWindowsApp();
      expect(windows(app).sync(true)).toBe(true);
      expect(app.run.get(AUTO_LAUNCH_NAME)).toEqual({ enabled: true, args: [HIDDEN_ARG] });
    });

    it('writes nothing when the setting is off and no entry exists', () => {
      const app = fakeWindowsApp();
      expect(windows(app).sync(false)).toBe(false);
      expect(app.calls).toEqual([]);
    });

    it('keeps an entry disabled in Task Manager disabled, and reports off', () => {
      const app = fakeWindowsApp({ [AUTO_LAUNCH_NAME]: { enabled: false } });
      expect(windows(app).sync(true)).toBe(false);
      expect(app.run.get(AUTO_LAUNCH_NAME).enabled).toBe(false);
      expect(app.calls).toEqual([]);
    });

    it('keeps an enabled entry on and refreshes it, even if the saved setting drifted to off', () => {
      const app = fakeWindowsApp({ [AUTO_LAUNCH_NAME]: { enabled: true } });
      expect(windows(app).sync(false)).toBe(true);
      expect(app.run.get(AUTO_LAUNCH_NAME)).toEqual({ enabled: true, args: [HIDDEN_ARG] });
    });
  });

  it('falls back to the saved setting and reports the error when the OS read fails', () => {
    const app = { getLoginItemSettings() { throw new Error('boom'); }, setLoginItemSettings() {} };
    const auto = windows(app);
    expect(auto.sync(true)).toBe(true);
    expect(auto.getStatus()).toEqual({ openAtLogin: false, error: 'boom' });
  });
});

describe('createAutoLaunch elsewhere', () => {
  it('never touches login items in dev mode', () => {
    const app = fakeWindowsApp();
    const auto = createAutoLaunch({ app, platform: 'win32', isDev: true, logger: quietLogger });
    auto.set(true);
    expect(auto.sync(true)).toBe(true);
    expect(auto.getStatus()).toEqual({ openAtLogin: false, isDev: true });
    expect(app.calls).toEqual([]);
  });

  it('uses openAtLogin on macOS, with no name or arguments', () => {
    const calls = [];
    const app = { getLoginItemSettings: () => ({ openAtLogin: true }), setLoginItemSettings: (o) => calls.push(o) };
    const auto = createAutoLaunch({ app, platform: 'darwin', logger: quietLogger });
    expect(auto.getStatus()).toEqual({ openAtLogin: true });
    expect(auto.sync(false)).toBe(false);
    expect(calls).toEqual([{ openAtLogin: false }]);
  });
});
