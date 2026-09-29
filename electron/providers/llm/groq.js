const { fetchJson } = require('../shared/http');

const GROQ_BASE = 'https://api.groq.com/openai/v1';

function headers(apiKey) {
  return { Authorization: `Bearer ${apiKey.trim()}`, 'Content-Type': 'application/json' };
}

function friendlyError(err) {
  if (err.status === 413 || err.status === 429) {
    const wrapped = new Error(
      `Groq rejected the request (${err.status}): the transcript likely exceeds your tokens-per-minute limit. ` +
      'Try a model with a higher limit, upgrade your Groq tier, or configure a fallback provider. ' +
      `(${err.message})`
    );
    wrapped.status = err.status;
    return wrapped;
  }
  return err;
}

async function generate({ systemPrompt, userPrompt, model, config, json }, deps = {}) {
  const apiKey = config.groqApiKey;
  if (!apiKey || !apiKey.trim()) throw new Error('Groq API key is required');

  const body = {
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
    const data = await fetchJson(
      `${GROQ_BASE}/chat/completions`,
      { method: 'POST', headers: headers(apiKey), body: JSON.stringify(body) },
      { label: 'Groq', fetchImpl: deps.fetchImpl || globalThis.fetch }
    );
    const text = data?.choices?.[0]?.message?.content;
    if (!text) throw new Error('No response from Groq API');
    return String(text).trim();
  } catch (err) {
    throw friendlyError(err);
  }
}

async function test({ config, model }, deps = {}) {
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

module.exports = {
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
