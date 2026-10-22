const { fetchJson, httpError } = require('../shared/http');
const { readEvents } = require('../shared/sse');

const CLAUDE_BASE = 'https://api.anthropic.com/v1';
const ANTHROPIC_VERSION = '2023-06-01';
// Claude 5.x models always think, and thinking shares this budget with the notes:
// 8K truncated an hour-long meeting on every model. Streaming keeps a large cap
// clear of fetch's 5-minute response-header timeout.
const MAX_OUTPUT_TOKENS = 64000;

// Claude 5.x and later models have deprecated the `temperature` parameter.
// Only include it for models that still accept it (3.x and earlier).
function supportsTemperature(model) {
  const match = /^claude-(?:instant-|sonnet-|opus-|haiku-|fable-|)(\d+)/.exec(model);
  if (!match) return false; // unknown model — omit to be safe
  return parseInt(match[1], 10) <= 3;
}

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
  if (err.status === 529) {
    const wrapped = new Error(
      'Anthropic is temporarily overloaded (529). Wait and retry, or configure a fallback provider. ' +
      `(${err.message})`
    );
    wrapped.status = 529;
    return wrapped;
  }
  return err;
}

/**
 * Stream a Messages request and return { text, stopReason, stopDetails }.
 * Only `text` blocks are collected (and passed to `onText` as they arrive);
 * Claude 5.x `thinking` blocks are skipped.
 */
async function streamMessage(apiKey, body, fetchImpl, onText) {
  const res = await fetchImpl(`${CLAUDE_BASE}/messages`, {
    method: 'POST',
    headers: headers(apiKey),
    body: JSON.stringify({ ...body, stream: true }),
  });
  if (!res.ok) throw httpError(res, await res.text(), 'Anthropic');

  const textBlocks = new Set();
  let text = '';
  let stopReason = null;
  let stopDetails = null;
  for await (const event of readEvents(res.body)) {
    if (event.type === 'content_block_start' && event.content_block?.type === 'text') {
      textBlocks.add(event.index);
      const delta = event.content_block.text || '';
      text += delta;
      if (delta) onText?.(delta);
    } else if (event.type === 'content_block_delta' && textBlocks.has(event.index)) {
      const delta = event.delta?.text || '';
      text += delta;
      if (delta) onText?.(delta);
    } else if (event.type === 'message_delta') {
      stopReason = event.delta?.stop_reason ?? stopReason;
      stopDetails = event.delta?.stop_details ?? stopDetails;
    } else if (event.type === 'error') {
      // Errors after the 200 arrive in the stream; map them like HTTP errors.
      const err = new Error(`Anthropic error (stream): ${event.error?.message || event.error?.type || 'unknown'}`);
      if (event.error?.type === 'overloaded_error') err.status = 529;
      if (event.error?.type === 'rate_limit_error') err.status = 429;
      throw err;
    }
  }
  return { text, stopReason, stopDetails };
}

async function generate({ systemPrompt, userPrompt, model, config, onText }, deps = {}) {
  const apiKey = config.claudeApiKey;
  if (!apiKey || !apiKey.trim()) throw new Error('Anthropic API key is required');

  const body = {
    model,
    max_tokens: MAX_OUTPUT_TOKENS,
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
    ...(supportsTemperature(model) ? { temperature: 0.3 } : {}),
  };

  try {
    const { text, stopReason, stopDetails } = await streamMessage(
      apiKey,
      body,
      deps.fetchImpl || globalThis.fetch,
      onText
    );
    // Throw rather than return partial notes, so the fallback provider gets a turn.
    if (stopReason === 'max_tokens') {
      throw new Error(
        `Anthropic stopped at the ${MAX_OUTPUT_TOKENS}-token output limit before finishing the notes. ` +
        'Try a lower-effort model such as Haiku, or configure a fallback provider.'
      );
    }
    if (stopReason === 'refusal') {
      const reason = stopDetails?.explanation || stopDetails?.category || 'no reason given';
      throw new Error(`Anthropic declined to write notes for this transcript (${reason}).`);
    }
    if (!text.trim()) throw new Error('No response from Anthropic API');
    return text.trim();
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
    { id: 'claude-sonnet-5-5', name: 'Claude Sonnet 5.5', badge: 'Default', description: 'Balanced performance for production — best all-round choice for meeting notes with a 1M context window.' },
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
