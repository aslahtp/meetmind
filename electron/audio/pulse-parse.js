// Parsers for `pactl` output (PulseAudio, and PipeWire through pipewire-pulse). Pure: no electron
// import, unit-tested in tests/pulseParse.test.js. pactl is always run with LC_ALL=C (see
// pulse.js), so field names are in English.

/**
 * `pactl info` → { serverName, defaultSink, defaultSource }. Missing fields are null; the
 * default sink or source is "@DEFAULT_SINK@"-style or empty when there is none.
 */
function parsePactlInfo(text) {
  const field = (name) => {
    const match = (text || '').match(new RegExp(`^${name}:[ \\t]*(.*)$`, 'm'));
    const value = match ? match[1].trim() : '';
    return value && value !== 'n/a' ? value : null;
  };
  return {
    serverName: field('Server Name'),
    defaultSink: field('Default Sink'),
    defaultSource: field('Default Source'),
  };
}

/**
 * `pactl list short sources` → [{ name, isMonitor }]. Each line is tab-separated:
 * index, name, driver, sample spec, state. A monitor source (`<sink>.monitor`) carries what
 * that output device plays, which is how Linux records system audio.
 */
function parseShortSources(text) {
  return (text || '')
    .split(/\r?\n/)
    .map((line) => line.split('\t'))
    .filter((cols) => cols.length >= 2 && /^\d+$/.test(cols[0].trim()) && cols[1].trim())
    .map((cols) => {
      const name = cols[1].trim();
      return { name, isMonitor: name.endsWith('.monitor') };
    });
}

/**
 * `pactl list source-outputs` → [{ id, binary, pid, appName }], one per stream recording from
 * a source (a microphone, or a monitor). binary is the lowercase process name pipewire-pulse
 * or PulseAudio reports (`application.process.binary`), or null when the client didn't say.
 */
function parseSourceOutputs(text) {
  const outputs = [];
  let current = null;
  for (const line of (text || '').split(/\r?\n/)) {
    const header = line.match(/^Source Output #(\d+)/);
    if (header) {
      current = { id: Number(header[1]), binary: null, pid: null, appName: null };
      outputs.push(current);
      continue;
    }
    if (!current) continue;
    const prop = line.match(/^\s+([\w.]+) = "(.*)"\s*$/);
    if (!prop) continue;
    const [, key, value] = prop;
    if (key === 'application.process.binary') current.binary = value.toLowerCase() || null;
    else if (key === 'application.process.id') current.pid = Number(value) || null;
    else if (key === 'application.name') current.appName = value || null;
  }
  return outputs;
}

/**
 * The sources a Linux FFmpeg recording uses: the default output's monitor (system audio) and
 * the default input (microphone), each null when there is none. A default source that is itself
 * a monitor isn't a microphone.
 */
function pickPulseSources(info, sources = []) {
  const names = new Set(sources.map((s) => s.name));
  const monitor = info?.defaultSink ? `${info.defaultSink}.monitor` : null;
  const system = monitor && (names.size === 0 || names.has(monitor)) ? monitor : null;
  const defaultSource = info?.defaultSource || null;
  const mic = defaultSource && !defaultSource.endsWith('.monitor') ? defaultSource : null;
  return { system, mic };
}

module.exports = { parsePactlInfo, parseShortSources, parseSourceOutputs, pickPulseSources };
