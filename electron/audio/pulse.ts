// Linux audio server access through `pactl` (from pulseaudio-utils; works with PulseAudio and
// with PipeWire's pipewire-pulse). Used by the Linux FFmpeg recording fallback (`-f pulse`),
// meeting detection (which apps are recording) and the smoke test. No electron import.

import { execFile } from 'child_process';
import { parsePactlInfo, parseShortSources, parseSourceOutputs, pickPulseSources } from './pulse-parse';

// English field names whatever the user's locale; the parsers rely on them.
const PACTL_ENV = { ...process.env, LC_ALL: 'C' };

function pactl(args: string[], timeout = 3000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('pactl', args, { env: PACTL_ENV, timeout, maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => {
      if (err) {
        if (err.code === 'ENOENT') reject(new Error('pactl not found (install pulseaudio-utils)'));
        else reject(err);
      } else {
        resolve(stdout);
      }
    });
  });
}

/** The audio server and its default devices: { serverName, defaultSink, defaultSource }. */
async function pulseInfo() {
  return parsePactlInfo(await pactl(['info']));
}

/** Every source: [{ name, isMonitor }]. */
async function listPulseSources() {
  return parseShortSources(await pactl(['list', 'short', 'sources']));
}

/** Every stream recording from a source: [{ id, binary, pid, appName }]. */
async function listSourceOutputs() {
  return parseSourceOutputs(await pactl(['list', 'source-outputs']));
}

/** The default output's monitor and the default microphone, for an FFmpeg recording. */
async function defaultPulseSources() {
  const [info, sources] = await Promise.all([pulseInfo(), listPulseSources()]);
  return { ...pickPulseSources(info, sources), sources };
}

export { pulseInfo, listPulseSources, listSourceOutputs, defaultPulseSources };
