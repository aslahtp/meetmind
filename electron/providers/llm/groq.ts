import type { LLMGenerateArgs, LLMProvider, ProviderDeps, ProviderTestArgs } from '../../shared';
import { fetchJson, httpError, type HttpError } from '../shared/http';
import { readEvents } from '../shared/sse';

const GROQ_BASE = 'https://api.groq.com/openai/v1';

function headers(apiKey: string) {
  return { Authorization: `Bearer ${apiKey.trim()}`, 'Content-Type': 'application/json' };
}

function friendlyError(thrown: unknown) {
  const err = thrown as HttpError;
  if (err.status === 413 || err.status === 429) {
    const wrapped: HttpError = new Error(
      `Groq rejected the request (${err.status}): the transcript likely exceeds your tokens-per-minute limit. ` +
      'Try a model with a higher limit, upgrade your Groq tier, or configure a fallback provider. ' +
      `(${err.message})`
    );
    wrapped.status = err.status;
    return wrapped;
  }
  return thrown;
}

/** The fields of a chat-completion stream event that are read here. */
interface GroqStreamEvent {
  error?: { message?: string; type?: string; status?: number };
  choices?: Array<{ delta?: { content?: string } }>;
}

/** Stream a chat completion, passing each content delta to `onText`, and return the full text. */
async function streamCompletion(
  apiKey: string,
  body: Record<string, unknown>,
  fetchImpl: typeof fetch,
  onText?: (delta: string) => void
) {
  const res = await fetchImpl(`${GROQ_BASE}/chat/completions`, {
    method: 'POST',
    headers: headers(apiKey),
    body: JSON.stringify({ ...body, stream: true }),
  });
  if (!res.ok) throw httpError(res, await res.text(), 'Groq');

  let text = '';
  for await (const event of readEvents<GroqStreamEvent>(res.body!)) {
    if (event.error) {
      const err: HttpError = new Error(`Groq error (stream): ${event.error.message || event.error.type || 'unknown'}`);
      if (Number.isInteger(event.error.status)) err.status = event.error.status;
      throw err;
    }
    const delta = event.choices?.[0]?.delta?.content || '';
    text += delta;
    if (delta) onText?.(delta);
  }
  return text;
}

async function generate({ systemPrompt, userPrompt, model, config, json, onText }: LLMGenerateArgs, deps: ProviderDeps = {}) {
  const apiKey = config.groqApiKey;
  if (!apiKey || !apiKey.trim()) throw new Error('Groq API key is required');
  const fetchImpl = deps.fetchImpl || globalThis.fetch;

  const body: Record<string, unknown> = {
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    temperature: 0.3,
  };
  // JSON mode requires the word "JSON" in the messages; buildUserPrompt guarantees it.
  if (json) body.response_format = { type: 'json_object' };

  try {
    let text: string;
    try {
      text = await streamCompletion(apiKey, body, fetchImpl, onText);
    } catch (thrown) {
      const err = thrown as HttpError;
      // Some models refuse to stream in JSON mode; ask again without streaming.
      if (!(json && err.status === 400 && /stream/i.test(err.message))) throw err;
      const data = (await fetchJson(
        `${GROQ_BASE}/chat/completions`,
        { method: 'POST', headers: headers(apiKey), body: JSON.stringify(body) },
        { label: 'Groq', fetchImpl }
      )) as { choices?: Array<{ message?: { content?: string } }> } | null;
      text = data?.choices?.[0]?.message?.content || '';
    }
    if (!text) throw new Error('No response from Groq API');
    return String(text).trim();
  } catch (err) {
    throw friendlyError(err);
  }
}

async function test({ config, model }: ProviderTestArgs, deps: ProviderDeps = {}) {
  const apiKey = config.groqApiKey;
  if (!apiKey || !apiKey.trim()) throw new Error('Groq API key is required');
  try {
    await fetchJson(
      `${GROQ_BASE}/chat/completions`,
      {
        method: 'POST',
        headers: headers(apiKey),
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: 'Reply with "OK" only.' }],
          max_tokens: 8,
        }),
      },
      { label: 'Groq', fetchImpl: deps.fetchImpl || globalThis.fetch }
    );
  } catch (err) {
    throw friendlyError(err);
  }
}

const provider: LLMProvider = {
  id: 'groq',
  name: 'Groq',
  badge: 'Llama & GPT-OSS',
  icon: 'groq',
  pricing: 'Free tier with rate limits, then pay-per-token',
  description:
    'Extremely fast open-model inference. Free-tier token-per-minute limits can reject very long transcripts; pair with a fallback provider for long meetings.',
  credentials: [
    {
      configKey: 'groqApiKey',
      label: 'Groq API key',
      type: 'password',
      placeholder: 'gsk_...',
      hint: 'The same Groq key is used for Groq speech-to-text.',
      link: { href: 'https://console.groq.com/keys', label: 'Groq console' },
      required: true,
    },
  ],
  guide: [
    { text: 'Go to the Groq Console', url: 'https://console.groq.com/keys' },
    { text: 'Sign up / log in and click "Create API Key"' },
    { text: 'Paste the key into the Groq API key field' },
  ],
  models: [
    { id: 'llama-3.3-70b-versatile', name: 'Llama 3.3 70B Versatile', badge: 'Default', description: 'Strong general-purpose model with a 128K context window.' },
    { id: 'openai/gpt-oss-120b', name: 'GPT-OSS 120B', badge: 'Pro', description: 'Largest open model on Groq; best for long or complex meetings.' },
    { id: 'openai/gpt-oss-20b', name: 'GPT-OSS 20B', badge: 'Fast', description: 'Quick and capable for typical meetings.' },
    { id: 'llama-3.1-8b-instant', name: 'Llama 3.1 8B Instant', badge: 'Lite', description: 'Lowest latency and cost; best for short meetings.' },
  ],
  defaultModel: 'llama-3.3-70b-versatile',
  allowCustomModel: true,
  generate,
  test,
};

export default provider;
