// Win32 reads for meeting detection, via koffi FFI (no compiled addon):
// - which apps hold the microphone right now (the privacy-indicator consent registry), and
// - the visible top-level windows with their titles, owning exe and bounds.
// koffi is loaded lazily so requiring this file never touches native code; on any failure the
// readers return [] and `isAvailable()` reports false.

const path = require('path');
const { exeFromConsentKey } = require('./meeting-rules');

const MIC_KEY = 'Software\\Microsoft\\Windows\\CurrentVersion\\CapabilityAccessManager\\ConsentStore\\microphone';
const HKEY_CURRENT_USER = -2147483647;   // (HKEY)(LONG)0x80000001, sign-extended
const KEY_READ = 0x20019;
const RRF_RT_REG_QWORD = 0x40;
const ERROR_SUCCESS = 0;
const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;
const PID_CACHE_MS = 60 * 1000;

let api = null;
let loadError = null;

function load() {
  if (api || loadError) return api;
  if (process.platform !== 'win32') {
    loadError = new Error('Meeting detection is Windows-only');
    return null;
  }
  try {
    const koffi = require('koffi');
    const user32 = koffi.load('user32.dll');
    const kernel32 = koffi.load('kernel32.dll');
    const advapi32 = koffi.load('advapi32.dll');

    const RECT = koffi.struct('MM_RECT', { left: 'int32', top: 'int32', right: 'int32', bottom: 'int32' });
    const EnumWindowsProc = koffi.proto('bool __stdcall MM_EnumWindowsProc(void *hwnd, intptr_t lParam)');

    api = {
      EnumWindows: user32.func('bool __stdcall EnumWindows(MM_EnumWindowsProc *cb, intptr_t lParam)'),
      IsWindowVisible: user32.func('bool __stdcall IsWindowVisible(void *hwnd)'),
      GetWindowTextLengthW: user32.func('int __stdcall GetWindowTextLengthW(void *hwnd)'),
      GetWindowTextW: user32.func('int __stdcall GetWindowTextW(void *hwnd, void *buf, int max)'),
      GetWindowThreadProcessId: user32.func('uint32 __stdcall GetWindowThreadProcessId(void *hwnd, _Out_ uint32 *pid)'),
      GetWindowRect: user32.func('bool __stdcall GetWindowRect(void *hwnd, _Out_ MM_RECT *rect)'),
      OpenProcess: kernel32.func('void * __stdcall OpenProcess(uint32 access, bool inherit, uint32 pid)'),
      QueryFullProcessImageNameW: kernel32.func('bool __stdcall QueryFullProcessImageNameW(void *proc, uint32 flags, void *buf, _Inout_ uint32 *size)'),
      CloseHandle: kernel32.func('bool __stdcall CloseHandle(void *h)'),
      RegOpenKeyExW: advapi32.func('long __stdcall RegOpenKeyExW(intptr_t key, str16 subKey, uint32 options, uint32 sam, _Out_ intptr_t *result)'),
      RegEnumKeyExW: advapi32.func('long __stdcall RegEnumKeyExW(intptr_t key, uint32 index, void *name, _Inout_ uint32 *nameLen, void *reserved, void *cls, void *clsLen, void *lastWrite)'),
      RegGetValueW: advapi32.func('long __stdcall RegGetValueW(intptr_t key, str16 subKey, str16 value, uint32 flags, void *type, void *data, _Inout_ uint32 *dataLen)'),
      RegCloseKey: advapi32.func('long __stdcall RegCloseKey(intptr_t key)'),
      RECT,
      EnumWindowsProc,
    };
  } catch (err) {
    loadError = err;
    api = null;
  }
  return api;
}

function isAvailable() {
  return !!load();
}

function getLoadError() {
  load();
  return loadError;
}

// ── Microphone ──────────────────────────────────────────────────────────────

function listSubkeys(handle) {
  const names = [];
  const buf = Buffer.alloc(512 * 2);
  for (let i = 0; ; i++) {
    const len = [buf.length / 2];
    const rc = api.RegEnumKeyExW(handle, i, buf, len, null, null, null, null);
    if (rc !== ERROR_SUCCESS) break;   // ERROR_NO_MORE_ITEMS (259) ends the walk
    names.push(buf.toString('utf16le', 0, len[0] * 2));
  }
  return names;
}

function isInUse(handle, subkey) {
  const data = Buffer.alloc(8);
  const size = [8];
  const rc = api.RegGetValueW(handle, subkey, 'LastUsedTimeStop', RRF_RT_REG_QWORD, null, data, size);
  return rc === ERROR_SUCCESS && data.readBigUInt64LE(0) === 0n;
}

function micUsersUnder(subPath, skip) {
  const out = [];
  const handle = [0];
  if (api.RegOpenKeyExW(HKEY_CURRENT_USER, subPath, 0, KEY_READ, handle) !== ERROR_SUCCESS) return out;
  try {
    for (const name of listSubkeys(handle[0])) {
      if (name === skip) continue;
      if (isInUse(handle[0], name)) out.push(exeFromConsentKey(name));
    }
  } finally {
    api.RegCloseKey(handle[0]);
  }
  return out;
}

// Consent-registry ids (exe names, or package family names) that hold the mic right now.
function listMicInUseApps() {
  if (!load()) return [];
  try {
    return [...micUsersUnder(`${MIC_KEY}\\NonPackaged`), ...micUsersUnder(MIC_KEY, 'NonPackaged')];
  } catch {
    return [];
  }
}

// ── Windows ─────────────────────────────────────────────────────────────────

const pidCache = new Map();   // pid -> exe basename (lowercase)
let pidCacheAt = 0;

function exeForPid(pid) {
  const now = Date.now();
  if (now - pidCacheAt > PID_CACHE_MS) {
    pidCache.clear();
    pidCacheAt = now;
  }
  if (pidCache.has(pid)) return pidCache.get(pid);
  let exe = '';
  const proc = api.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid);
  if (proc) {
    try {
      const buf = Buffer.alloc(1024 * 2);
      const size = [1024];
      if (api.QueryFullProcessImageNameW(proc, 0, buf, size)) {
        exe = path.win32.basename(buf.toString('utf16le', 0, size[0] * 2)).toLowerCase();
      }
    } finally {
      api.CloseHandle(proc);
    }
  }
  pidCache.set(pid, exe);
  return exe;
}

// Visible, titled top-level windows as { exe, title, bounds: { x, y, width, height } }.
function listVisibleWindows() {
  if (!load()) return [];
  const windows = [];
  const buf = Buffer.alloc(512 * 2);
  try {
    api.EnumWindows((hwnd) => {
      try {
        if (!api.IsWindowVisible(hwnd) || api.GetWindowTextLengthW(hwnd) === 0) return true;
        const n = api.GetWindowTextW(hwnd, buf, buf.length / 2);
        if (n <= 0) return true;
        const pid = [0];
        api.GetWindowThreadProcessId(hwnd, pid);
        const rect = {};
        api.GetWindowRect(hwnd, rect);
        windows.push({
          exe: exeForPid(pid[0]),
          title: buf.toString('utf16le', 0, n * 2),
          bounds: { x: rect.left, y: rect.top, width: rect.right - rect.left, height: rect.bottom - rect.top },
        });
      } catch {
        // skip a window that vanished mid-enumeration
      }
      return true;
    }, 0);
  } catch {
    return windows;
  }
  return windows;
}

module.exports = { isAvailable, getLoadError, listMicInUseApps, listVisibleWindows };
