import { describe, it, expect, vi, type Mock } from 'vitest';
import assemblyai from '../electron/providers/stt/assemblyai';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { sttRegistry, llmRegistry, describeProviders, providerConfigKeys } from '../electron/providers/index';
import { createRegistry, type Registry } from '../electron/providers/registry';
import type { Config, ProviderDescriptor } from '../electron/shared';
import * as wav from '../electron/providers/shared/wav';
import groqStt from '../electron/providers/stt/groq';
import groqLlm from '../electron/providers/llm/groq';
import claudeLlm from '../electron/providers/llm/claude';
import geminiLlm from '../electron/providers/llm/gemini';
import { readEvents } from '../electron/providers/shared/sse';
import { generateNotes } from '../electron/services/notes';
import { migrateLegacyModels } from '../electron/utils/configMigration';

type FetchMock = Mock<typeof fetch>;

function fakeResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: 'x',
    headers: { get: (k: string) => headers[k.toLowerCase()] ?? null },
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  } as unknown as Response;
}

/** The init argument of a mocked fetch's n-th call. */
const initOf = (fetchImpl: FetchMock, n = 0): RequestInit => fetchImpl.mock.calls[n]?.[1] ?? {};

/** The parsed JSON body of a mocked fetch's n-th call. */
const bodyOf = (fetchImpl: FetchMock, n = 0) => JSON.parse(String(initOf(fetchImpl, n).body));

/**
 * A 200 server-sent-events response, split across chunks to exercise buffering.
 * `done` ends it with the OpenAI-style `data: [DONE]` sentinel.
 */
function fakeStream(events: Array<Record<string, unknown>>, { done = false } = {}): Response {
  const sse = events.map((e) => `event: ${String(e.type)}\ndata: ${JSON.stringify(e)}\n\n`).join('')
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
  } as unknown as Response;
}

/** Stream events for a Claude reply made of the given content blocks. */
function claudeEvents(blocks: Array<{ type: string; text?: string }>, stopReason = 'end_turn', stopDetails: unknown = null): Array<Record<string, unknown>> {
  return [
    { type: 'message_start', message: { content: [] } },
    ...blocks.flatMap((b, index): Array<Record<string, unknown>> => b.type === 'text'
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
  for (const [kind, registry] of [['stt', sttRegistry], ['llm', llmRegistry]] as Array<[string, Registry]>) {
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
    expect(() => reg.register({ id: 'x' } as ProviderDescriptor)).toThrow(/missing/);
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
    expect(llmRegistry.get('gemini').latestModels!.map((m) => m.id)).toEqual([
      'gemini-flash-latest', 'gemini-flash-lite-latest', 'gemini-pro-latest',
    ]);
  });

  it('accepts a latest alias even when custom IDs are not allowed', () => {
    const reg = createRegistry('llm', ['generate', 'test']);
    const p = reg.register({
      id: 'x', name: 'X', credentials: [], models: [{ id: 'm1', name: 'm1' }], latestModels: [{ id: 'x-latest', name: 'x-latest' }],
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
    const segs = groqStt._internals!.parseGroqSegments(
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
    const fetchImpl = vi.fn<typeof fetch>(async () => responses.shift()!);
    const sleepImpl = vi.fn(async () => {});

    try {
      const segments = await groqStt.transcribe(
        { wavPath: file, model: 'whisper-large-v3-turbo', config: { groqApiKey: 'gsk_x' } },
        { fetchImpl, sleepImpl, durationSeconds: 900, extractChunk: () => Buffer.alloc(4) }
      );
      expect(segments.map((s) => s.text)).toEqual(['first', 'second']);
      expect(segments[1].startTime).toBeCloseTo(598); // second chunk starts at 600 - 2s overlap
      expect(sleepImpl).toHaveBeenCalledWith(1000);
      const init = initOf(fetchImpl);
      expect((init.headers as Record<string, string>).Authorization).toBe('Bearer gsk_x');
      expect((init.body as FormData).get('model')).toBe('whisper-large-v3-turbo');
    } finally {
      fs.unlinkSync(file);
    }
  });

  it('requires an API key', async () => {
    await expect(groqStt.transcribe({ wavPath: 'x', model: 'm', config: {} })).rejects.toThrow(/API key/);
  });
});

/** OpenAI-compatible chat-completion chunks streaming the given text pieces. */
function groqChunks(pieces: string[]) {
  return [
    { choices: [{ index: 0, delta: { role: 'assistant', content: '' } }] },
    ...pieces.map((content) => ({ choices: [{ index: 0, delta: { content } }] })),
    { choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] },
  ];
}

describe('SSE reader', () => {
  it('yields JSON events across chunk boundaries and stops at [DONE]', async () => {
    const events: unknown[] = [];
    for await (const e of readEvents(fakeStream([{ type: 'a', n: 1 }, { type: 'b', n: 2 }], { done: true }).body!)) {
      events.push(e);
    }
    expect(events).toEqual([{ type: 'a', n: 1 }, { type: 'b', n: 2 }]);
  });
});

describe('AssemblyAI STT', () => {
  const options = (model: string, prompt?: string) => assemblyai._requestOptions!({ wavPath: 'a.wav', model, prompt });

  it('defaults to Universal-3.5 Pro, including for a saved Universal-3 Pro', () => {
    expect(assemblyai.defaultModel).toBe('universal-3-5-pro');
    expect(sttRegistry.resolveModel(assemblyai, '')).toBe('universal-3-5-pro');
    expect(sttRegistry.resolveModel(assemblyai, 'universal-3-pro')).toBe('universal-3-5-pro');
    expect(sttRegistry.resolveModel(assemblyai, 'universal-2')).toBe('universal-2');
  });

  it('lets Universal-3.5 Pro detect the language, with Universal-2 for the rest', () => {
    const o = options('universal-3-5-pro');
    expect(o.speech_models).toEqual(['universal-3-5-pro', 'universal-2']);
    expect(o.language_detection).toBe(true);
    expect(o.language_codes).toBeUndefined(); // can't be combined with language_detection
    expect(o.speaker_labels).toBe(true);
  });

  it('keeps Universal-2 on its fixed language list', () => {
    expect(options('universal-2')).toMatchObject({ speech_models: ['universal-2'], language_codes: ['en', 'ml'] });
    expect(options('universal-2').language_detection).toBeUndefined();
  });

  it('passes a trimmed prompt only when one is set', () => {
    expect(options('universal-3-5-pro', '  Kubernetes, MeetMind ').prompt).toBe('Kubernetes, MeetMind');
    expect(options('universal-3-5-pro', '   ').prompt).toBeUndefined();
  });
});

describe('Groq LLM', () => {
  const base = { systemPrompt: 's', userPrompt: 'u', model: 'llama-3.3-70b-versatile', config: { groqApiKey: 'k' } };

  it('streams deltas to onText and returns the trimmed text', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => fakeStream(groqChunks([' # No', 'tes\n\nBody ']), { done: true }));
    const deltas: string[] = [];
    const text = await groqLlm.generate({ ...base, onText: (d) => deltas.push(d) }, { fetchImpl });
    expect(text).toBe('# Notes\n\nBody');
    expect(deltas).toEqual([' # No', 'tes\n\nBody ']);
    expect(bodyOf(fetchImpl).stream).toBe(true);
  });

  it('asks again without streaming when a model refuses to stream JSON', async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(fakeResponse(400, { error: { message: 'response_format does not support streaming' } }))
      .mockResolvedValueOnce(fakeResponse(200, { choices: [{ message: { content: '{"a":1}' } }] }));
    expect(await groqLlm.generate({ ...base, json: true }, { fetchImpl })).toBe('{"a":1}');
    expect(bodyOf(fetchImpl, 1).stream).toBeUndefined();
  });

  it('throws an error sent mid-stream', async () => {
    const fetchImpl = async () => fakeStream([{ error: { message: 'boom', type: 'internal_server_error' } }]);
    await expect(groqLlm.generate(base, { fetchImpl })).rejects.toThrow(/Groq error \(stream\): boom/);
  });

  it('sends json_object only in JSON mode', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => fakeStream(groqChunks([' {"a":1} ']), { done: true }));

    expect(await groqLlm.generate({ ...base, json: true }, { fetchImpl })).toBe('{"a":1}');
    expect(bodyOf(fetchImpl, 0).response_format).toEqual({ type: 'json_object' });

    await groqLlm.generate({ ...base, json: false }, { fetchImpl });
    expect(bodyOf(fetchImpl, 1).response_format).toBeUndefined();
  });

  it('maps token-limit errors to an actionable message', async () => {
    const fetchImpl = async () => fakeResponse(413, { error: { message: 'too large' } });
    await expect(
      groqLlm.generate({ systemPrompt: 's', userPrompt: 'u', model: 'm', config: { groqApiKey: 'k' } }, { fetchImpl })
    ).rejects.toThrow(/tokens-per-minute/);
  });
});

describe('Gemini LLM', () => {
  /** Stand-in for @google/genai streaming the given text pieces. */
  interface SdkCalls {
    apiKey?: string;
    opts?: unknown;
    prompt?: unknown;
  }

  interface StreamParams {
    model: string;
    contents: unknown;
    config?: { systemInstruction?: unknown };
  }

  function fakeSdk(pieces: string[], calls: SdkCalls, last: object = {}) {
    return {
      GoogleGenAI: class {
        constructor({ apiKey }: { apiKey: string }) { calls.apiKey = apiKey; }
        models = {
          async generateContentStream({ model, contents, config }: StreamParams) {
            calls.prompt = contents;
            calls.opts = { model, systemInstruction: config?.systemInstruction };
            return (async function* () {
              for (const p of pieces) yield { text: p };
              if (!pieces.length) yield { text: undefined, ...last };
            })();
          },
        };
      },
    };
  }

  it('streams deltas to onText and returns the trimmed text', async () => {
    const calls: SdkCalls = {};
    const deltas: string[] = [];
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

  it("turns the SDK's nested JSON error into a readable message with its status", async () => {
    const body = JSON.stringify({ error: { code: 400, message: 'API key not valid. Please pass a valid API key.', status: 'INVALID_ARGUMENT' } });
    const failing = {
      GoogleGenAI: class {
        models = {
          async generateContentStream(): Promise<never> {
            throw new Error(JSON.stringify({ error: { message: body } })); // streaming nests the body once more
          },
        };
      },
    };
    const err = await geminiLlm
      .generate({ systemPrompt: 's', userPrompt: 'u', model: 'm', config: { geminiApiKey: 'g' } }, { sdk: failing })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toBe('Gemini API error (400): API key not valid. Please pass a valid API key.');
    expect((err as Error & { status?: number }).status).toBe(400);
  });

  it('throws on an empty answer, naming why, so the fallback model runs', async () => {
    const blocked = fakeSdk([], {}, { promptFeedback: { blockReason: 'SAFETY' } });
    await expect(
      geminiLlm.generate({ systemPrompt: 's', userPrompt: 'u', model: 'm', config: { geminiApiKey: 'g' } }, { sdk: blocked })
    ).rejects.toThrow('Gemini returned no text (SAFETY)');
  });
});

describe('Claude LLM', () => {
  it('streams /v1/messages and returns trimmed text', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      fakeStream(claudeEvents([{ type: 'text', text: '  # Notes\n\nBody  ' }]))
    );
    const result = await claudeLlm.generate(
      { systemPrompt: 's', userPrompt: 'u', model: 'claude-sonnet-5-5', config: { claudeApiKey: 'sk-ant-x' } },
      { fetchImpl }
    );
    expect(result).toBe('# Notes\n\nBody');
    const [url, init] = fetchImpl.mock.calls[0] ?? [];
    expect(String(url)).toContain('/v1/messages');
    expect((init?.headers as Record<string, string>)['x-api-key']).toBe('sk-ant-x');
    const body = bodyOf(fetchImpl);
    expect(body.system).toBe('s');
    expect(body.stream).toBe(true);
    expect(body.max_tokens).toBeGreaterThan(8192);
    expect(body.temperature).toBeUndefined();
  });

  it('omits temperature for Claude 5.x and includes it for legacy Claude 3.x', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => fakeStream(claudeEvents([{ type: 'text', text: 'ok' }])));
    await claudeLlm.generate(
      { systemPrompt: 's', userPrompt: 'u', model: 'claude-3-5-sonnet-20241022', config: { claudeApiKey: 'sk-ant-x' } },
      { fetchImpl }
    );
    const bodyLegacy = bodyOf(fetchImpl, 0);
    expect(bodyLegacy.temperature).toBe(0.3);

    await claudeLlm.generate(
      { systemPrompt: 's', userPrompt: 'u', model: 'claude-opus-5-5', config: { claudeApiKey: 'sk-ant-x' } },
      { fetchImpl }
    );
    const body5 = bodyOf(fetchImpl, 1);
    expect(body5.temperature).toBeUndefined();
  });

  const generateWith = (fetchImpl: typeof fetch) =>
    claudeLlm.generate({ systemPrompt: 's', userPrompt: 'u', model: 'claude-opus-5-5', config: { claudeApiKey: 'k' } }, { fetchImpl });

  it('passes text deltas, not thinking, to onText', async () => {
    const fetchImpl = async () =>
      fakeStream(claudeEvents([{ type: 'thinking' }, { type: 'text', text: '# Notes' }]));
    const deltas: string[] = [];
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
  const baseConfig: Partial<Config> = {
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
      expect(res.fallback!.primary.provider).toBe('groq');
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
      expect(spy.mock.calls[0]?.[0].userPrompt).toContain('"Weekly Sync"');
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
    expect(set.llmModels?.gemini).toBe('gemini-3.8-flash');
  });
});
