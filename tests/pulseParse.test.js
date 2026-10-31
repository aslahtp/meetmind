import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { parsePactlInfo, parseShortSources, parseSourceOutputs, pickPulseSources } = require('../electron/audio/pulse-parse.js');
const { buildAmixFilter, buildSingleDeviceArgs } = require('../electron/audio/mixer.js');

const INFO = `Server String: /run/user/1000/pulse/native
Library Protocol Version: 35
Server Protocol Version: 35
Is Local: yes
Client Index: 82
Tile Size: 65472
User Name: me
Host Name: laptop
Server Name: PulseAudio (on PipeWire 1.0.5)
Server Version: 15.0.0
Default Sample Specification: float32le 2ch 48000Hz
Default Channel Map: front-left,front-right
Default Sink: alsa_output.pci-0000_00_1f.3.analog-stereo
Default Source: alsa_input.pci-0000_00_1f.3.analog-stereo
Cookie: 9b2f:0d1c
`;

const SOURCES = [
  '48\talsa_output.pci-0000_00_1f.3.analog-stereo.monitor\tPipeWire\ts32le 2ch 48000Hz\tSUSPENDED',
  '49\talsa_input.pci-0000_00_1f.3.analog-stereo\tPipeWire\ts32le 2ch 48000Hz\tRUNNING',
  '',
].join('\n');

const SOURCE_OUTPUTS = `Source Output #91
\tDriver: PipeWire
\tOwner Module: n/a
\tClient: 90
\tSource: 49
\tSample Specification: float32le 1ch 48000Hz
\tProperties:
\t\tclient.api = "pipewire-pulse"
\t\tapplication.name = "Google Chrome"
\t\tapplication.process.id = "41234"
\t\tapplication.process.binary = "chrome"
\t\tmedia.name = "RecordStream"

Source Output #95
\tDriver: PipeWire
\tSource: 49
\tProperties:
\t\tapplication.name = "ZOOM VoiceEngine"
\t\tapplication.process.id = "5120"
\t\tapplication.process.binary = "zoom"
`;

describe('parsePactlInfo', () => {
  it('reads the server and the default output and input', () => {
    expect(parsePactlInfo(INFO)).toEqual({
      serverName: 'PulseAudio (on PipeWire 1.0.5)',
      defaultSink: 'alsa_output.pci-0000_00_1f.3.analog-stereo',
      defaultSource: 'alsa_input.pci-0000_00_1f.3.analog-stereo',
    });
  });

  it('returns nulls for missing fields', () => {
    expect(parsePactlInfo('Server Name: pulseaudio\nDefault Sink: \n')).toEqual({ serverName: 'pulseaudio', defaultSink: null, defaultSource: null });
    expect(parsePactlInfo('')).toEqual({ serverName: null, defaultSink: null, defaultSource: null });
  });
});

describe('parseShortSources', () => {
  it('lists sources and marks output monitors', () => {
    expect(parseShortSources(SOURCES)).toEqual([
      { name: 'alsa_output.pci-0000_00_1f.3.analog-stereo.monitor', isMonitor: true },
      { name: 'alsa_input.pci-0000_00_1f.3.analog-stereo', isMonitor: false },
    ]);
  });
});

describe('parseSourceOutputs', () => {
  it('reads each recording stream and the process behind it', () => {
    expect(parseSourceOutputs(SOURCE_OUTPUTS)).toEqual([
      { id: 91, binary: 'chrome', pid: 41234, appName: 'Google Chrome' },
      { id: 95, binary: 'zoom', pid: 5120, appName: 'ZOOM VoiceEngine' },
    ]);
  });

  it('returns nothing when no app is recording', () => {
    expect(parseSourceOutputs('')).toEqual([]);
  });
});

describe('pickPulseSources', () => {
  const info = parsePactlInfo(INFO);

  it('records the default output monitor and the default microphone', () => {
    expect(pickPulseSources(info, parseShortSources(SOURCES))).toEqual({
      system: 'alsa_output.pci-0000_00_1f.3.analog-stereo.monitor',
      mic: 'alsa_input.pci-0000_00_1f.3.analog-stereo',
    });
  });

  it('skips a monitor that does not exist and a default source that is a monitor', () => {
    const sources = [{ name: 'other.monitor', isMonitor: true }];
    expect(pickPulseSources({ ...info, defaultSource: 'x.monitor' }, sources)).toEqual({ system: null, mic: null });
  });
});

describe('PulseAudio FFmpeg arguments', () => {
  it('mixes the monitor and the microphone through two pulse inputs', () => {
    const { inputs, filterParts, outputArgs } = buildAmixFilter('sink.monitor', 'mic', { backend: 'pulse' });
    expect(inputs).toEqual([
      '-f', 'pulse', '-thread_queue_size', '512', '-i', 'sink.monitor',
      '-f', 'pulse', '-thread_queue_size', '512', '-i', 'mic',
    ]);
    expect(filterParts).toContain('-filter_complex');
    expect(outputArgs).toEqual(['-ar', '16000', '-ac', '1', '-acodec', 'pcm_s16le']);
  });

  it('records one pulse source on its own', () => {
    expect(buildAmixFilter(null, 'mic', { backend: 'pulse' }).inputs).toEqual(['-f', 'pulse', '-thread_queue_size', '512', '-i', 'mic']);
    expect(buildSingleDeviceArgs('sink.monitor', { backend: 'pulse' }).inputs).toEqual(['-f', 'pulse', '-thread_queue_size', '512', '-i', 'sink.monitor']);
  });

  it('keeps the Windows inputs by default', () => {
    expect(buildAmixFilter(null, 'Microphone (Realtek)').inputs).toContain('dshow');
  });
});
