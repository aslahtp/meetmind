const { fetchJson } = require('../shared/http');

const CLAUDE_BASE = 'https://api.anthropic.com/v1';
const ANTHROPIC_VERSION = '2023-06-01';

function headers(apiKey) {
  return {
    'x-api-key': apiKey.trim(),
    'anthropic-version': ANTHROPIC_VERSION,
    'content-type': 'application/json',
  };
}

function friendlyError(err) {
  if (err.status === 429) {
    const wrapped = new Error(
      `Anthropic rate-limited the request (429): you have exceeded your rate limit. ` +
      'Try a smaller model, wait and retry, or configure a fallback provider. ' +
      `(${err.message})`
    );
    wrapped.status = 429;
    return wrapped;
  }
  if (err.status === 413) {
    const wrapped = new Error(
      `Anthropic rejected the request (413): the transcript is too large for this model's context. ` +
      'Try a model with a larger context window or configure a fallback provider. ' +
      `(${err.message})`
    );
    wrapped.status = 413;
    return wrapped;
  }
  return err;
}

async function generate({ systemPrompt, userPrompt, model, config }, deps = {}) {
  const apiKey = config.claudeApiKey;
  if (!apiKey || !apiKey.trim()) throw new Error('Anthropic API key is required');

  const body = {
    model,
    max_tokens: 8192,
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
    temperature: 0.3,
  };

  try {
    const data = await fetchJson(
      `${CLAUDE_BASE}/messages`,
      { method: 'POST', headers: headers(apiKey), body: JSON.stringify(body) },
      { label: 'Anthropic', fetchImpl: deps.fetchImpl || globalThis.fetch }
    );
    const text = data?.content?.[0]?.text;
    if (!text) throw new Error('No response from Anthropic API');
    return String(text).trim();
  } catch (err) {
    throw friendlyError(err);
  }
}

async function test({ config, model }, deps = {}) {
  const apiKey = config.claudeApiKey;
  if (!apiKey || !apiKey.trim()) throw new Error('Anthropic API key is required');

  try {
    await fetchJson(
      `${CLAUDE_BASE}/messages`,
      {
        method: 'POST',
        headers: headers(apiKey),
        body: JSON.stringify({
          model,
          max_tokens: 8,
          messages: [{ role: 'user', content: 'Reply with "OK" only.' }],
        }),
      },
      { label: 'Anthropic', fetchImpl: deps.fetchImpl || globalThis.fetch }
    );
  } catch (err) {
    throw friendlyError(err);
  }
}

module.exports = {
  id: 'claude',
  name: 'Anthropic Claude',
  badge: 'Claude 5',
  icon: 'claude',
  pricing: 'Pay-per-token, no free tier',
  description:
    "Anthropic's Claude models excel at long-context reasoning and nuanced summarisation. Claude Sonnet 5.5 offers the best balance of quality and speed for meeting notes.",
  credentials: [
    {
      configKey: 'claudeApiKey',
      label: 'Anthropic API key',
      type: 'password',
      placeholder: 'sk-ant-...',
      link: { href: 'https://console.anthropic.com/settings/keys', label: 'Anthropic console' },
      required: true,
    },
  ],
  guide: [
    { text: 'Go to the Anthropic Console', url: 'https://console.anthropic.com/settings/keys' },
    { text: "Sign up / log in and click 'Generate Key'" },
    { text: 'Paste the key into the Anthropic API key field' },
  ],
  models: [
    { id: 'claude-sonnet-5-5', name: 'Claude Sonnet 5.5', badge: 'Default', description: 'Balanced performance for production — best all-round choice for meeting notes with a 200K context window.' },
    { id: 'claude-fable-5-1', name: 'Claude Fable 5.1', badge: 'Flagship', description: "Anthropic's most capable model; best for demanding reasoning and complex or lengthy meetings." },
    { id: 'claude-opus-5-5', name: 'Claude Opus 5.5', badge: 'Pro', description: 'Expert-level model optimised for agentic coding and knowledge work; high quality at lower cost than Fable.' },
    { id: 'claude-haiku-5-5', name: 'Claude Haiku 5.5', badge: 'Fast', description: 'Fastest and most cost-efficient Claude model; best for short meetings or high-volume use.' },
  ],
  defaultModel: 'claude-sonnet-5-5',
  allowCustomModel: true,
  // Retired model IDs saved in older configs, mapped to their replacements.
  _deprecatedModels: {
    'claude-sonnet-4-5': 'claude-sonnet-5-5',
    'claude-opus-4-5': 'claude-opus-5-5',
    'claude-haiku-3-5': 'claude-haiku-5-5',
  },
  generate,
  test,
};
