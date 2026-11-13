// Win32 reads for meeting detection, via koffi FFI (no compiled addon):
// - which apps hold the microphone right now, from two sources: the apps with an active WASAPI
//   capture session (the documented audio API) and the privacy-indicator consent registry, which
//   some Windows installs stop updating, and
// - the visible top-level windows with their titles, owning exe and bounds.
// koffi is loaded lazily so requiring this file never touches native code; on any failure the
// readers return [] and `isAvailable()` reports false.

import path from 'path';
import type { TypeObject } from 'koffi' with { 'resolution-mode': 'require' };
import type { Bounds } from '../shared/overlay';
import { errorMessage } from '../utils/errors';
import { exeFromConsentKey, mergeMicUsers, type MicUsers, type WindowInfo } from './meeting-rules';

type Koffi = typeof import('koffi', { with: { 'resolution-mode': 'require' } });

/** An opaque pointer or handle (HWND, HANDLE, COM object): only ever passed back to the API. */
type Handle = unknown;

/** What a koffi `_Out_`/`_Inout_` pointer argument takes: a one-element array that koffi fills in. */
type OutValue<T> = T[];

interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

interface Guid {
  data1: number;
  data2: number;
  data3: number;
  data4: number[];
}

type ComMethod =
  | 'QueryInterface'
  | 'Release'
  | 'EnumAudioEndpoints'
  | 'GetCount'
  | 'Item'
  | 'Activate'
  | 'GetSessionEnumerator'
  | 'GetSession'
  | 'GetState'
  | 'GetProcessId';

/** The user32/kernel32/advapi32/ole32 functions this file binds, typed as koffi converts them. */
interface Win32Api {
  koffi: Koffi;
  EnumWindows(cb: (hwnd: Handle) => boolean, lParam: number): boolean;
  IsWindowVisible(hwnd: Handle): boolean;
  GetWindowTextLengthW(hwnd: Handle): number;
  GetWindowTextW(hwnd: Handle, buf: Buffer, max: number): number;
  GetWindowThreadProcessId(hwnd: Handle, pid: OutValue<number>): number;
  GetWindowRect(hwnd: Handle, rect: Rect): boolean;
  OpenProcess(access: number, inherit: boolean, pid: number): Handle | null;
  QueryFullProcessImageNameW(proc: Handle, flags: number, buf: Buffer, size: OutValue<number>): boolean;
  CloseHandle(handle: Handle): boolean;
  RegOpenKeyExW(key: number, subKey: string, options: number, sam: number, result: OutValue<number>): number;
  RegEnumKeyExW(
    key: number,
    index: number,
    name: Buffer,
    nameLen: OutValue<number>,
    reserved: null,
    cls: null,
    clsLen: null,
    lastWrite: null,
  ): number;
  RegGetValueW(
    key: number,
    subKey: string,
    value: string,
    flags: number,
    type: null,
    data: Buffer,
    dataLen: OutValue<number>,
  ): number;
  RegCloseKey(key: number): number;
  CoInitializeEx(reserved: null, flags: number): number;
  CoCreateInstance(clsid: Guid, outer: null, ctx: number, iid: Guid, out: OutValue<Handle>): number;
  /** COM method prototypes, called through each object's vtable (see comCall). */
  com: Record<ComMethod, TypeObject>;
  ptrSize: number;
  RECT: TypeObject;
  EnumWindowsProc: TypeObject;
}

const MIC_KEY = 'Software\\Microsoft\\Windows\\CurrentVersion\\CapabilityAccessManager\\ConsentStore\\microphone';
const HKEY_CURRENT_USER = -2147483647;   // (HKEY)(LONG)0x80000001, sign-extended
const KEY_READ = 0x20019;
const RRF_RT_REG_QWORD = 0x40;
const ERROR_SUCCESS = 0;
const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;
const PID_CACHE_MS = 60 * 1000;

// WASAPI (mmdeviceapi.h / audiopolicy.h)
const CLSID_MMDeviceEnumerator = 'BCDE0395-E52F-467C-8E3D-C4579291692E';
const IID_IMMDeviceEnumerator = 'A95664D2-9614-4F35-A746-DE8DB63617E6';
const IID_IAudioSessionManager2 = '77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F';
const IID_IAudioSessionControl2 = 'BFB7FF88-7239-4FC9-8FA2-07C950BE9C6D';
const CLSCTX_ALL = 0x17;
const COINIT_APARTMENTTHREADED = 0x2;
const E_CAPTURE = 1;
const DEVICE_STATE_ACTIVE = 1;
const AUDIO_SESSION_STATE_ACTIVE = 1;
// vtable slots; 0–2 are IUnknown's QueryInterface, AddRef, Release.
const SLOT = {
  QueryInterface: 0,
  Release: 2,
  EnumAudioEndpoints: 3,     // IMMDeviceEnumerator
  CollectionGetCount: 3,     // IMMDeviceCollection
  CollectionItem: 4,
  Activate: 3,               // IMMDevice
  GetSessionEnumerator: 5,   // IAudioSessionManager2
  SessionGetCount: 3,        // IAudioSessionEnumerator
  GetSession: 4,
  GetState: 3,               // IAudioSessionControl
  GetProcessId: 14,          // IAudioSessionControl2
};

let api: Win32Api | null = null;
let loadError: Error | null = null;

function load(): Win32Api | null {
  if (api || loadError) return api;
  if (process.platform !== 'win32') {
    loadError = new Error('Meeting detection is Windows-only');
    return null;
  }
  try {
    const koffi: Koffi = require('koffi');
    const user32 = koffi.load('user32.dll');
    const kernel32 = koffi.load('kernel32.dll');
    const advapi32 = koffi.load('advapi32.dll');
    const ole32 = koffi.load('ole32.dll');

    const RECT = koffi.struct('MM_RECT', { left: 'int32', top: 'int32', right: 'int32', bottom: 'int32' });
    const EnumWindowsProc = koffi.proto('bool __stdcall MM_EnumWindowsProc(void *hwnd, intptr_t lParam)');
    koffi.struct('MM_GUID', { data1: 'uint32', data2: 'uint16', data3: 'uint16', data4: koffi.array('uint8', 8) });

    api = {
      koffi,
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
      CoInitializeEx: ole32.func('long __stdcall CoInitializeEx(void *reserved, uint32 flags)'),
      CoCreateInstance: ole32.func('long __stdcall CoCreateInstance(MM_GUID *clsid, void *outer, uint32 ctx, MM_GUID *iid, _Out_ void **out)'),
      // COM methods, called through each object's vtable (see comCall).
      com: {
        QueryInterface: koffi.proto('long __stdcall MM_QueryInterface(void *self, MM_GUID *iid, _Out_ void **out)'),
        Release: koffi.proto('uint32 __stdcall MM_Release(void *self)'),
        EnumAudioEndpoints: koffi.proto('long __stdcall MM_EnumAudioEndpoints(void *self, int flow, uint32 mask, _Out_ void **out)'),
        GetCount: koffi.proto('long __stdcall MM_GetCount(void *self, _Out_ uint32 *count)'),
        Item: koffi.proto('long __stdcall MM_Item(void *self, uint32 index, _Out_ void **out)'),
        Activate: koffi.proto('long __stdcall MM_Activate(void *self, MM_GUID *iid, uint32 ctx, void *params, _Out_ void **out)'),
        GetSessionEnumerator: koffi.proto('long __stdcall MM_GetSessionEnumerator(void *self, _Out_ void **out)'),
        GetSession: koffi.proto('long __stdcall MM_GetSession(void *self, int index, _Out_ void **out)'),
        GetState: koffi.proto('long __stdcall MM_GetState(void *self, _Out_ int *state)'),
        GetProcessId: koffi.proto('long __stdcall MM_GetProcessId(void *self, _Out_ uint32 *pid)'),
      },
      ptrSize: koffi.sizeof('void *'),
      RECT,
      EnumWindowsProc,
    };
  } catch (err) {
    loadError = err instanceof Error ? err : new Error(errorMessage(err));
    api = null;
  }
  return api;
}

// For the readers below, which only run once load() has succeeded.
function loaded(): Win32Api {
  const loadedApi = load();
  if (!loadedApi) throw loadError || new Error('Win32 API not loaded');
  return loadedApi;
}

function isAvailable(): boolean {
  return !!load();
}

function getLoadError(): Error | null {
  load();
  return loadError;
}

// ── Microphone ──────────────────────────────────────────────────────────────

function listSubkeys(handle: number): string[] {
  const api = loaded();
  const names: string[] = [];
  const buf = Buffer.alloc(512 * 2);
  for (let i = 0; ; i++) {
    const len = [buf.length / 2];
    const rc = api.RegEnumKeyExW(handle, i, buf, len, null, null, null, null);
    if (rc !== ERROR_SUCCESS) break;   // ERROR_NO_MORE_ITEMS (259) ends the walk
    names.push(buf.toString('utf16le', 0, len[0] * 2));
  }
  return names;
}

function isInUse(handle: number, subkey: string): boolean {
  const data = Buffer.alloc(8);
  const size = [8];
  const rc = loaded().RegGetValueW(handle, subkey, 'LastUsedTimeStop', RRF_RT_REG_QWORD, null, data, size);
  return rc === ERROR_SUCCESS && data.readBigUInt64LE(0) === 0n;
}

function micUsersUnder(subPath: string, skip?: string): string[] {
  const api = loaded();
  const out: string[] = [];
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
function listRegistryMicApps(): string[] {
  if (!load()) return [];
  try {
    return [...micUsersUnder(`${MIC_KEY}\\NonPackaged`), ...micUsersUnder(MIC_KEY, 'NonPackaged')];
  } catch {
    return [];
  }
}

// Every app recording from a microphone has an audio session on that capture device, active while
// its stream runs. Unlike the consent registry this is a documented API, and it keeps working
// where Windows has stopped updating the registry.

function guid(text: string): Guid {
  const hex = text.replace(/-/g, '');
  return {
    data1: parseInt(hex.slice(0, 8), 16),
    data2: parseInt(hex.slice(8, 12), 16),
    data3: parseInt(hex.slice(12, 16), 16),
    data4: [...Buffer.from(hex.slice(16), 'hex')],
  };
}

// Every COM method here returns an HRESULT (long) or, for Release, a reference count (uint32).
function comCall(obj: Handle, slot: number, proto: TypeObject, ...args: unknown[]): number {
  const { koffi, ptrSize } = loaded();
  const vtable = koffi.decode(obj, 'void *');
  const fn = koffi.decode(vtable, slot * ptrSize, 'void *');
  return koffi.call(fn, proto, obj, ...args);
}

function checkHr(hr: number, what: string): void {
  if (hr < 0) throw new Error(`${what} failed (0x${(hr >>> 0).toString(16)})`);
}

// COM stays initialised for the life of the process. S_FALSE (already initialised) and
// RPC_E_CHANGED_MODE (the thread is in the other apartment) both leave COM usable.
let comInitialized = false;
function initCom(): void {
  if (comInitialized) return;
  loaded().CoInitializeEx(null, COINIT_APARTMENTTHREADED);
  comInitialized = true;
}

// Exe names (lowercase) with an active capture session on any active microphone. Throws if the
// audio API itself fails; one device failing (e.g. unplugged mid-read) only skips that device.
function listCaptureSessionApps(): string[] {
  const api = load();
  if (!api) return [];
  initCom();
  const { com } = api;
  const held: Handle[] = [];   // every COM object obtained, released in reverse order below
  const obtain = (what: string, call: (out: Handle[]) => number): Handle => {
    const out: Handle[] = [null];
    checkHr(call(out), what);
    if (!out[0]) throw new Error(`${what} returned nothing`);
    held.push(out[0]);
    return out[0];
  };
  const exes = new Set<string>();
  try {
    const enumerator = obtain('CoCreateInstance(MMDeviceEnumerator)', (out) =>
      api.CoCreateInstance(guid(CLSID_MMDeviceEnumerator), null, CLSCTX_ALL, guid(IID_IMMDeviceEnumerator), out));
    const devices = obtain('EnumAudioEndpoints', (out) =>
      comCall(enumerator, SLOT.EnumAudioEndpoints, com.EnumAudioEndpoints, E_CAPTURE, DEVICE_STATE_ACTIVE, out));
    const deviceCount = [0];
    checkHr(comCall(devices, SLOT.CollectionGetCount, com.GetCount, deviceCount), 'IMMDeviceCollection::GetCount');

    for (let i = 0; i < deviceCount[0]; i++) {
      try {
        const device = obtain('IMMDeviceCollection::Item', (out) => comCall(devices, SLOT.CollectionItem, com.Item, i, out));
        const manager = obtain('IMMDevice::Activate', (out) =>
          comCall(device, SLOT.Activate, com.Activate, guid(IID_IAudioSessionManager2), CLSCTX_ALL, null, out));
        const sessions = obtain('GetSessionEnumerator', (out) =>
          comCall(manager, SLOT.GetSessionEnumerator, com.GetSessionEnumerator, out));
        const sessionCount = [0];
        checkHr(comCall(sessions, SLOT.SessionGetCount, com.GetCount, sessionCount), 'IAudioSessionEnumerator::GetCount');

        for (let j = 0; j < sessionCount[0]; j++) {
          const control = obtain('GetSession', (out) => comCall(sessions, SLOT.GetSession, com.GetSession, j, out));
          const state = [0];
          if (comCall(control, SLOT.GetState, com.GetState, state) < 0 || state[0] !== AUDIO_SESSION_STATE_ACTIVE) continue;
          const control2 = obtain('QueryInterface(IAudioSessionControl2)', (out) =>
            comCall(control, SLOT.QueryInterface, com.QueryInterface, guid(IID_IAudioSessionControl2), out));
          const pid = [0];
          if (comCall(control2, SLOT.GetProcessId, com.GetProcessId, pid) < 0 || !pid[0]) continue;
          const exe = exeForPid(pid[0]);
          if (exe) exes.add(exe);
        }
      } catch {
        // skip a device that failed or vanished mid-read
      }
    }
  } finally {
    for (let k = held.length - 1; k >= 0; k--) comCall(held[k], SLOT.Release, com.Release);
  }
  return [...exes];
}

// Both mic sources, kept apart so the detector can log which one works. `sessionsError` is set
// when the audio API failed and only the registry was read.
function readMicUsers(): MicUsers {
  const result: MicUsers = { sessions: [], registry: [], sessionsError: null };
  if (!load()) return result;
  try {
    result.sessions = listCaptureSessionApps();
  } catch (err) {
    result.sessionsError = errorMessage(err);
  }
  result.registry = listRegistryMicApps();
  return result;
}

// Ids of the apps holding the mic right now, from both sources.
function listMicInUseApps(): string[] {
  const { sessions, registry } = readMicUsers();
  return mergeMicUsers(sessions, registry);
}

// ── Windows ─────────────────────────────────────────────────────────────────

const pidCache = new Map<number, string>();   // pid -> exe basename (lowercase)
let pidCacheAt = 0;

function exeForPid(pid: number): string {
  const api = loaded();
  const now = Date.now();
  if (now - pidCacheAt > PID_CACHE_MS) {
    pidCache.clear();
    pidCacheAt = now;
  }
  const cached = pidCache.get(pid);
  if (cached !== undefined) return cached;
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
function listVisibleWindows(): WindowInfo[] {
  const api = load();
  if (!api) return [];
  const windows: WindowInfo[] = [];
  const buf = Buffer.alloc(512 * 2);
  try {
    api.EnumWindows((hwnd) => {
      try {
        if (!api.IsWindowVisible(hwnd) || api.GetWindowTextLengthW(hwnd) === 0) return true;
        const n = api.GetWindowTextW(hwnd, buf, buf.length / 2);
        if (n <= 0) return true;
        const pid = [0];
        api.GetWindowThreadProcessId(hwnd, pid);
        const rect = {} as Rect;   // koffi fills in the _Out_ struct
        api.GetWindowRect(hwnd, rect);
        const bounds: Bounds = { x: rect.left, y: rect.top, width: rect.right - rect.left, height: rect.bottom - rect.top };
        windows.push({
          exe: exeForPid(pid[0]),
          title: buf.toString('utf16le', 0, n * 2),
          bounds,
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

export { isAvailable, getLoadError, readMicUsers, listMicInUseApps, listVisibleWindows };
