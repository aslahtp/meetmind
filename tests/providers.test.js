import { describe, it, expect, vi } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { sttRegistry, llmRegistry, describeProviders, providerConfigKeys } = require('../electron/providers/index.js');
const { createRegistry } = require('../electron/providers/registry.js');
const wav = require('../electron/providers/shared/wav.js');
const groqStt = require('../electron/providers/stt/groq.js');
const groqLlm = require('../electron/providers/llm/groq.js');
const claudeLlm = require('../electron/providers/llm/claude.js');
const geminiLlm = require('../electron/providers/llm/gemini.js');
const { readEvents } = require('../electron/providers/shared/sse.js');
const { generateNotes } = require('../electron/services/notes.js');
const { migrateLegacyModels } = require('../electron/utils/configMigration.js');

function fakeResponse(status, body, headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: 'x',
    headers: { get: (k) => headers[k.toLowerCase()] ?? null },
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  };
}

/**
 * A 200 server-sent-events response, split across chunks to exercise buffering.
 * `done` ends it with the OpenAI-style `data: [DONE]` sentinel.
 */
function fakeStream(events, { done = false } = {}) {
  const sse = events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join('')
    + (done ? 'data: [DONE]\n\n' : '');
  const bytes = new TextEncoder().encode(sse);
  const mid = Math.floor(bytes.length / 2);
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(bytes.slice(0, mid));
        controller.enqueue(bytes.slice(mid));
        controller.close();
      },
    }),
  };
}

/** Stream events for a Claude reply made of the given content blocks. */
function claudeEvents(blocks, stopReason = 'end_turn', stopDetails = null) {
  return [
    { type: 'message_start', message: { content: [] } },
    ...blocks.flatMap((b, index) => b.type === 'text'
      ? [
        { type: 'content_block_start', index, content_block: { type: 'text', text: '' } },
        { type: 'content_block_delta', index, delta: { type: 'text_delta', text: b.text } },
        { type: 'content_block_stop', index },
      ]
      : [
        { type: 'content_block_start', index, content_block: { type: 'thinking', thinking: '' } },
        { type: 'content_block_delta', index, delta: { type: 'thinking_delta', thinking: 'hmm' } },
        { type: 'content_block_stop', index },
      ]),
    { type: 'message_delta', delta: { stop_reason: stopReason, stop_details: stopDetails } },
    { type: 'message_stop' },
  ];
}

describe('provider registry contract', () => {
  for (const [kind, registry] of [['stt', sttRegistry], ['llm', llmRegistry]]) {
    describe(kind, () => {
      it('has unique ids and a valid default model for every provider', () => {
        const ids = registry.list().map((p) => p.id);
        expect(new Set(ids).size).toBe(ids.length);
        for (const p of registry.list()) {
          expect(p.models.some((m) => m.id === p.defaultModel)).toBe(true);
          expect(p.credentials.some((f) => f.required)).toBe(true);
          for (const f of p.credentials) expect(f.configKey).toBeTruthy();
        }
      });

      it('keeps latest-model aliases unique and separate from the pinned models', () => {
        for (const p of registry.list()) {
          const latest = (p.latestModels || []).map((m) => m.id);
          expect(new Set(latest).size).toBe(latest.length);
          for (const id of latest) expect(p.models.some((m) => m.id === id)).toBe(false);
        }
      });
    });
  }

  it('includes Groq for both STT and LLM', () => {
    expect(sttRegistry.has('groq')).toBe(true);
    expect(llmRegistry.has('groq')).toBe(true);
  });

  it('includes Claude in the LLM registry', () => {
    expect(llmRegistry.has('claude')).toBe(true);
  });

  it('serializes descriptors without functions', () => {
    const json = JSON.parse(JSON.stringify(describeProviders()));
    expect(json.stt.length).toBe(sttRegistry.list().length);
    expect(JSON.stringify(describeProviders())).not.toContain('_internals');
    for (const p of [...describeProviders().stt, ...describeProviders().llm]) {
      for (const v of Object.values(p)) expect(typeof v).not.toBe('function');
    }
  });

  it('shares groqApiKey between STT and LLM without duplicating the config key', () => {
    const keys = providerConfigKeys().map((k) => k.configKey);
    expect(keys.filter((k) => k === 'groqApiKey')).toHaveLength(1);
  });

  it('rejects incomplete and duplicate providers', () => {
    const reg = createRegistry('llm', ['generate', 'test']);
    expect(() => reg.register({ id: 'x' })).toThrow(/missing/);
    const ok = { id: 'x', name: 'X', credentials: [], models: [], defaultModel: 'm', generate() {}, test() {} };
    reg.register(ok);
    expect(() => reg.register(ok)).toThrow(/Duplicate/);
  });

  it('resolves models against the curated list unless custom IDs are allowed', () => {
    const strict = sttRegistry.get('assemblyai');
    expect(sttRegistry.resolveModel(strict, 'nope')).toBe(strict.defaultModel);
    const open = llmRegistry.get('groq');
    expect(llmRegistry.resolveModel(open, 'my/custom-model')).toBe('my/custom-model');
    expect(llmRegistry.resolveModel(open, '')).toBe(open.defaultModel);
  });

  it('offers Gemini\'s auto-updating latest aliases', () => {
    expect(llmRegistry.get('gemini').latestModels.map((m) => m.id)).toEqual([
      'gemini-flash-latest', 'gemini-flash-lite-latest', 'gemini-pro-latest',
    ]);
  });

  it('accepts a latest alias even when custom IDs are not allowed', () => {
    const reg = createRegistry('llm', ['generate', 'test']);
    const p = reg.register({
      id: 'x', name: 'X', credentials: [], models: [{ id: 'm1' }], latestModels: [{ id: 'x-latest' }],
      defaultModel: 'm1', generate() {}, test() {},
    });
    expect(reg.resolveModel(p, 'x-latest')).toBe('x-latest');
    expect(reg.resolveModel(p, 'other')).toBe('m1');
  });
});

describe('wav chunk planning', () => {
  it('covers the duration with overlap and no empty tail chunk', () => {
    expect(wav.planChunks(120, 55, 5)).toEqual([
      { start: 0, end: 55 }, { start: 50, end: 105 }, { start: 100, end: 120 },
    ]);
    expect(wav.planChunks(30, 600, 2)).toEqual([{ start: 0, end: 30 }]);
  });
});

describe('Groq STT', () => {
  it('parses verbose_json segments with an offset', () => {
    const segs = groqStt._internals.parseGroqSegments(
      { segments: [{ start: 1, end: 2, text: ' Hi ' }, { start: 2, end: 3, text: '  ' }] }, 600
    );
    expect(segs).toEqual([{ speaker: 'Speaker 1', text: 'Hi', startTime: 601, endTime: 602 }]);
  });

  it('transcribes chunks, offsets timestamps and retries after a 429', async () => {
    const file = path.join(os.tmpdir(), `meetmind-groq-${Date.now()}.wav`);
    fs.writeFileSync(file, Buffer.alloc(10));
    const responses = [
      fakeResponse(429, { error: { message: 'rate limit' } }, { 'retry-after': '1' }),
      fakeResponse(200, { segments: [{ start: 0, end: 5, text: 'first' }] }),
      fakeResponse(200, { segments: [{ start: 0, end: 5, text: 'second' }] }),
    ];
    const fetchImpl = vi.fn(async () => responses.shift());
    const sleepImpl = vi.fn(async () => {});

    try {
      const segments = await groqStt.transcribe(
        { wavPath: file, model: 'whisper-large-v3-turbo', config: { groqApiKey: 'gsk_x' } },
        { fetchImpl, sleepImpl, durationSeconds: 900, extractChunk: () => Buffer.alloc(4) }
      );
      expect(segments.map((s) => s.text)).toEqual(['first', 'second']);
      expect(segments[1].startTime).toBeCloseTo(598); // second chunk starts at 600 - 2s overlap
      expect(sleepImpl).toHaveBeenCalledWith(1000);
      const [, init] = fetchImpl.mock.calls[0];
      expect(init.headers.Authorization).toBe('Bearer gsk_x');
      expect(init.body.get('model')).toBe('whisper-large-v3-turbo');
    } finally {
      fs.unlinkSync(file);
    }
  });

  it('requires an API key', async () => {
    await expect(groqStt.transcribe({ wavPath: 'x', model: 'm', config: {} })).rejects.toThrow(/API key/);
  });
});

/** OpenAI-compatible chat-completion chunks streaming the given text pieces. */
function groqChunks(pieces) {
  return [
    { choices: [{ index: 0, delta: { role: 'assistant', content: '' } }] },
    ...pieces.map((content) => ({ choices: [{ index: 0, delta: { content } }] })),
    { choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] },
  ];
}

describe('SSE reader', () => {
  it('yields JSON events across chunk boundaries and stops at [DONE]', async () => {
    const events = [];
    for await (const e of readEvents(fakeStream([{ type: 'a', n: 1 }, { type: 'b', n: 2 }], { done: true }).body)) {
      events.push(e);
    }
    expect(events).toEqual([{ type: 'a', n: 1 }, { type: 'b', n: 2 }]);
  });
});

describe('Groq LLM', () => {
  const base = { systemPrompt: 's', userPrompt: 'u', model: 'llama-3.3-70b-versatile', config: { groqApiKey: 'k' } };

  it('streams deltas to onText and returns the trimmed text', async () => {
    const fetchImpl = vi.fn(async () => fakeStream(groqChunks([' # No', 'tes\n\nBody ']), { done: true }));
    const deltas = [];
    const text = await groqLlm.generate({ ...base, onText: (d) => deltas.push(d) }, { fetchImpl });
    expect(text).toBe('# Notes\n\nBody');
    expect(deltas).toEqual([' # No', 'tes\n\nBody ']);
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body).stream).toBe(true);
  });

  it('asks again without streaming when a model refuses to stream JSON', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(fakeResponse(400, { error: { message: 'response_format does not support streaming' } }))
      .mockResolvedValueOnce(fakeResponse(200, { choices: [{ message: { content: '{"a":1}' } }] }));
    expect(await groqLlm.generate({ ...base, json: true }, { fetchImpl })).toBe('{"a":1}');
    expect(JSON.parse(fetchImpl.mock.calls[1][1].body).stream).toBeUndefined();
  });

  it('throws an error sent mid-stream', async () => {
    const fetchImpl = async () => fakeStream([{ error: { message: 'boom', type: 'internal_server_error' } }]);
    await expect(groqLlm.generate(base, { fetchImpl })).rejects.toThrow(/Groq error \(stream\): boom/);
  });

  it('sends json_object only in JSON mode', async () => {
    const fetchImpl = vi.fn(async () => fakeStream(groqChunks([' {"a":1} ']), { done: true }));

    expect(await groqLlm.generate({ ...base, json: true }, { fetchImpl })).toBe('{"a":1}');
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body).response_format).toEqual({ type: 'json_object' });

    await groqLlm.generate({ ...base, json: false }, { fetchImpl });
    expect(JSON.parse(fetchImpl.mock.calls[1][1].body).response_format).toBeUndefined();
  });

  it('maps token-limit errors to an actionable message', async () => {
    const fetchImpl = async () => fakeResponse(413, { error: { message: 'too large' } });
    await expect(
      groqLlm.generate({ systemPrompt: 's', userPrompt: 'u', model: 'm', config: { groqApiKey: 'k' } }, { fetchImpl })
    ).rejects.toThrow(/tokens-per-minute/);
  });
});

describe('Gemini LLM', () => {
  /** Stand-in for @google/generative-ai streaming the given text pieces. */
  function fakeSdk(pieces, calls) {
    return {
      GoogleGenerativeAI: class {
        constructor(apiKey) { calls.apiKey = apiKey; }
        getGenerativeModel(opts) {
          calls.opts = opts;
          return {
            async generateContentStream(prompt) {
              calls.prompt = prompt;
              return {
                stream: (async function* () {
                  for (const p of pieces) yield { text: () => p };
                })(),
              };
            },
          };
        }
      },
    };
  }

  it('streams deltas to onText and returns the trimmed text', async () => {
    const calls = {};
    const deltas = [];
    const text = await geminiLlm.generate(
      { systemPrompt: 's', userPrompt: 'u', model: 'gemini-3.8-flash', config: { geminiApiKey: 'g' }, onText: (d) => deltas.push(d) },
      { sdk: fakeSdk(['# Notes', '', '\n\nBody '], calls) }
    );
    expect(text).toBe('# Notes\n\nBody');
    expect(deltas).toEqual(['# Notes', '\n\nBody ']);
    expect(calls).toMatchObject({ apiKey: 'g', prompt: 'u', opts: { model: 'gemini-3.8-flash', systemInstruction: 's' } });
  });

  it('requires an API key', async () => {
    await expect(geminiLlm.generate({ systemPrompt: 's', userPrompt: 'u', model: 'm', config: {} })).rejects.toThrow(/API key/);
  });
});

describe('Claude LLM', () => {
  it('streams /v1/messages and returns trimmed text', async () => {
    const fetchImpl = vi.fn(async () =>
      fakeStream(claudeEvents([{ type: 'text', text: '  # Notes\n\nBody  ' }]))
    );
    const result = await claudeLlm.generate(
      { systemPrompt: 's', userPrompt: 'u', model: 'claude-sonnet-5-5', config: { claudeApiKey: 'sk-ant-x' } },
      { fetchImpl }
    );
    expect(result).toBe('# Notes\n\nBody');
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toContain('/v1/messages');
    expect(init.headers['x-api-key']).toBe('sk-ant-x');
    const body = JSON.parse(init.body);
    expect(body.system).toBe('s');
    expect(body.stream).toBe(true);
    expect(body.max_tokens).toBeGreaterThan(8192);
    expect(body.temperature).toBeUndefined();
  });

  it('omits temperature for Claude 5.x and includes it for legacy Claude 3.x', async () => {
    const fetchImpl = vi.fn(async () => fakeStream(claudeEvents([{ type: 'text', text: 'ok' }])));
    await claudeLlm.generate(
      { systemPrompt: 's', userPrompt: 'u', model: 'claude-3-5-sonnet-20241022', config: { claudeApiKey: 'sk-ant-x' } },
      { fetchImpl }
    );
    const bodyLegacy = JSON.parse(fetchImpl.mock.calls[0][1].body);
    expect(bodyLegacy.temperature).toBe(0.3);

    await claudeLlm.generate(
      { systemPrompt: 's', userPrompt: 'u', model: 'claude-opus-5-5', config: { claudeApiKey: 'sk-ant-x' } },
      { fetchImpl }
    );
    const body5 = JSON.parse(fetchImpl.mock.calls[1][1].body);
    expect(body5.temperature).toBeUndefined();
  });

  const generateWith = (fetchImpl) =>
    claudeLlm.generate({ systemPrompt: 's', userPrompt: 'u', model: 'claude-opus-5-5', config: { claudeApiKey: 'k' } }, { fetchImpl });

  it('passes text deltas, not thinking, to onText', async () => {
    const fetchImpl = async () =>
      fakeStream(claudeEvents([{ type: 'thinking' }, { type: 'text', text: '# Notes' }]));
    const deltas = [];
    await claudeLlm.generate(
      { systemPrompt: 's', userPrompt: 'u', model: 'claude-opus-5-5', config: { claudeApiKey: 'k' }, onText: (d) => deltas.push(d) },
      { fetchImpl }
    );
    expect(deltas).toEqual(['# Notes']);
  });

  it('skips thinking blocks and returns the text that follows', async () => {
    const fetchImpl = async () =>
      fakeStream(claudeEvents([{ type: 'thinking' }, { type: 'text', text: '# Notes' }]));
    await expect(generateWith(fetchImpl)).resolves.toBe('# Notes');
  });

  it('throws when the response has no text block', async () => {
    const fetchImpl = async () => fakeStream(claudeEvents([{ type: 'thinking' }]));
    await expect(generateWith(fetchImpl)).rejects.toThrow(/No response/);
  });

  it('throws instead of returning notes cut off at the output limit', async () => {
    const fetchImpl = async () => fakeStream(claudeEvents([{ type: 'text', text: '# Notes\n\n- half' }], 'max_tokens'));
    await expect(generateWith(fetchImpl)).rejects.toThrow(/output limit/);
  });

  it('reports a refusal with its reason', async () => {
    const fetchImpl = async () =>
      fakeStream(claudeEvents([], 'refusal', { type: 'refusal', category: 'cyber', explanation: null }));
    await expect(generateWith(fetchImpl)).rejects.toThrow(/declined.*cyber/);
  });

  it('maps an overloaded error sent mid-stream', async () => {
    const fetchImpl = async () =>
      fakeStream([{ type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } }]);
    await expect(generateWith(fetchImpl)).rejects.toThrow(/overloaded \(529\)/);
  });

  it('maps rate-limit errors to an actionable message', async () => {
    const fetchImpl = async () => fakeResponse(429, { error: { message: 'rate limited' } });
    await expect(
      claudeLlm.generate({ systemPrompt: 's', userPrompt: 'u', model: 'm', config: { claudeApiKey: 'k' } }, { fetchImpl })
    ).rejects.toThrow(/rate-limited/);
  });

  it('requires an API key', async () => {
    await expect(
      claudeLlm.generate({ systemPrompt: 's', userPrompt: 'u', model: 'm', config: {} })
    ).rejects.toThrow(/API key/);
  });
});

describe('generateNotes fallback', () => {
  const transcript = [{ speaker: 'Speaker 1', text: 'hello', startTime: 0 }];
  const baseConfig = {
    geminiApiKey: 'g', groqApiKey: 'k', noteOutputMode: 'markdown',
    llmProvider: 'groq', llmModels: {}, llmFallback: { provider: 'gemini', model: 'gemini-3.7-flash' },
  };

  it('uses the cross-provider fallback when the primary fails', async () => {
    const groq = llmRegistry.get('groq');
    const gemini = llmRegistry.get('gemini');
    const g1 = vi.spyOn(groq, 'generate').mockRejectedValue(new Error('429'));
    const g2 = vi.spyOn(gemini, 'generate').mockResolvedValue('# Title\n\nBody');
    try {
      const res = await generateNotes(transcript, baseConfig);
      expect(res.provider).toBe('gemini');
      expect(res.model).toBe('gemini-3.7-flash');
      expect(res.fallback.primary.provider).toBe('groq');
      expect(res.notes._rawMarkdown).toContain('Body');
      expect(res.notes.title).toBe('Title');
    } finally {
      g1.mockRestore();
      g2.mockRestore();
    }
  });

  it('prompts with the meeting title and keeps it over the LLM title', async () => {
    const groq = llmRegistry.get('groq');
    const spy = vi.spyOn(groq, 'generate').mockResolvedValue('# Invented\n\nBody');
    try {
      const res = await generateNotes(transcript, baseConfig, { meetingTitle: 'Weekly Sync' });
      expect(spy.mock.calls[0][0].userPrompt).toContain('"Weekly Sync"');
      expect(res.notes.title).toBe('Weekly Sync');
      expect(res.notes._rawMarkdown).toBe('# Weekly Sync\n\nBody');
    } finally {
      spy.mockRestore();
    }
  });

  it('does not use a fallback when the primary succeeds', async () => {
    const groq = llmRegistry.get('groq');
    const spy = vi.spyOn(groq, 'generate').mockResolvedValue('# Ok');
    try {
      const res = await generateNotes(transcript, baseConfig);
      expect(res.provider).toBe('groq');
      expect(res.fallback).toBeNull();
    } finally {
      spy.mockRestore();
    }
  });

  it('fails when the primary is unconfigured and there is no fallback', async () => {
    await expect(
      generateNotes(transcript, { ...baseConfig, groqApiKey: '', llmFallback: {} })
    ).rejects.toThrow(/API key/);
  });
});

describe('config migration', () => {
  const deprecated = { 'gemini-3.5-flash': 'gemini-3.8-flash' };

  it('moves the legacy Gemini model and fallback into the new keys', () => {
    const { set, remove } = migrateLegacyModels(
      { selectedModel: 'gemini-3.5-flash', secondaryGeminiModel: 'gemini-3.7-flash' }, deprecated
    );
    expect(set.llmModels).toEqual({ gemini: 'gemini-3.8-flash' });
    expect(set.llmFallback).toEqual({ provider: 'gemini', model: 'gemini-3.7-flash' });
    expect(remove).toEqual(expect.arrayContaining(['selectedModel', 'geminiModel', 'secondaryGeminiModel']));
  });

  it('is a no-op once migrated and keeps existing choices', () => {
    expect(migrateLegacyModels({ llmModels: { gemini: 'gemini-3.8-flash' } }, deprecated)).toEqual({ set: {}, remove: [] });
    const { set } = migrateLegacyModels(
      { selectedModel: 'x', llmModels: { gemini: 'kept' }, secondaryGeminiModel: 'y', llmFallback: { provider: 'groq' } }, deprecated
    );
    expect(set.llmModels).toBeUndefined();
    expect(set.llmFallback).toBeUndefined();
  });

  it('remaps retired Gemini IDs saved under the new key', () => {
    const { set } = migrateLegacyModels({ llmModels: { gemini: 'gemini-3.5-flash' } }, deprecated);
    expect(set.llmModels.gemini).toBe('gemini-3.8-flash');
  });
});
