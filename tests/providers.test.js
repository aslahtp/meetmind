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
    });
  }

  it('includes Groq for both STT and LLM', () => {
    expect(sttRegistry.has('groq')).toBe(true);
    expect(llmRegistry.has('groq')).toBe(true);
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

describe('Groq LLM', () => {
  it('sends json_object only in JSON mode', async () => {
    const fetchImpl = vi.fn(async () => fakeResponse(200, { choices: [{ message: { content: ' {"a":1} ' } }] }));
    const base = { systemPrompt: 's', userPrompt: 'u', model: 'llama-3.3-70b-versatile', config: { groqApiKey: 'k' } };

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
