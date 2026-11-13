import type { LLMGenerateArgs, LLMProvider, ProviderDeps, ProviderTestArgs } from '../../shared';

// @google/genai's type declarations are ESM; the main process is CommonJS and loads its CJS build.
import type { GenerateContentResponse } from '@google/genai' with { 'resolution-mode': 'require' };

type GeminiSdk = typeof import('@google/genai', { with: { 'resolution-mode': 'require' } });

// Google's Gen AI SDK (@google/genai), loaded on first use; tests pass a stand-in as `deps.sdk`.
function loadSdk(deps: ProviderDeps): GeminiSdk {
  return (deps.sdk as GeminiSdk | undefined) || (require('@google/genai') as GeminiSdk);
}

// Why a response carried no text: a blocked prompt, or the reason generation stopped.
function noTextReason(response: GenerateContentResponse | undefined) {
  return response?.promptFeedback?.blockReason || response?.candidates?.[0]?.finishReason || '';
}

// The SDK puts Google's JSON error body in the message (nested once more while streaming). Unwrap
// it into the "<label> error (status): detail" form the other providers use (providers/shared/http.ts).
function readableError(err: unknown): unknown {
  if (!(err instanceof Error)) return err;
  let detail = err.message;
  let status = (err as { status?: unknown }).status;
  for (let depth = 0; depth < 3; depth++) {
    let inner: { message?: unknown; code?: unknown } | undefined;
    try { inner = (JSON.parse(detail) as { error?: typeof inner }).error; } catch { break; }
    if (typeof inner?.message !== 'string') break;
    detail = inner.message;
    if (typeof status !== 'number' && typeof inner.code === 'number') status = inner.code;
  }
  if (detail === err.message) return err;
  const readable: Error & { status?: number } = new Error(`Gemini API error${typeof status === 'number' ? ` (${status})` : ''}: ${detail}`);
  if (typeof status === 'number') readable.status = status;
  return readable;
}

async function generate({ systemPrompt, userPrompt, model, config, onText }: LLMGenerateArgs, deps: ProviderDeps = {}) {
  const apiKey = config.geminiApiKey;
  if (!apiKey) throw new Error('Gemini API key is required');

  const { GoogleGenAI } = loadSdk(deps);
  const ai = new GoogleGenAI({ apiKey });
  let text = '';
  let last: GenerateContentResponse | undefined;
  try {
    const stream = await ai.models.generateContentStream({
      model,
      contents: userPrompt,
      config: { systemInstruction: systemPrompt },
    });
    for await (const chunk of stream) {
      last = chunk;
      const delta = chunk.text ?? '';
      text += delta;
      if (delta) onText?.(delta);
    }
  } catch (err) {
    throw readableError(err);
  }
  // An empty answer (e.g. a blocked prompt) is an error, so the fallback model can take over.
  if (!text.trim()) {
    const reason = noTextReason(last);
    throw new Error(`Gemini returned no text${reason ? ` (${reason})` : ''}`);
  }
  return text.trim();
}

async function test({ config, model }: ProviderTestArgs, deps: ProviderDeps = {}) {
  const apiKey = config.geminiApiKey;
  if (!apiKey) throw new Error('Gemini API key is required');

  const { GoogleGenAI } = loadSdk(deps);
  const ai = new GoogleGenAI({ apiKey });
  let result: GenerateContentResponse;
  try {
    result = await ai.models.generateContent({ model, contents: 'Reply with "OK" only.' });
  } catch (err) {
    throw readableError(err);
  }
  if (!result.text) throw new Error('No response from Gemini API');
}

const provider: LLMProvider = {
  id: 'gemini',
  name: 'Google Gemini',
  badge: 'Gemini 3.8',
  icon: 'gemini',
  pricing: 'Free tier available, then pay-per-token',
  description: 'Fast, high-quality structured generation with a very large context window.',
  credentials: [
    {
      configKey: 'geminiApiKey',
      label: 'Google Gemini API key',
      type: 'password',
      placeholder: 'AIzaSy...',
      link: { href: 'https://aistudio.google.com/app/apikey', label: 'Get API key' },
      required: true,
    },
  ],
  guide: [
    { text: 'Go to Google AI Studio', url: 'https://aistudio.google.com/app/apikey' },
    { text: 'Click "Get API Key" → "Create API Key"' },
    { text: 'Copy the key and paste it into the Gemini API key field' },
  ],
  models: [
    { id: 'gemini-3.8-flash', name: 'Gemini 3.8 Flash', badge: 'Default', description: 'Fast, high-quality reasoning and structured generation. Best overall balance of speed and accuracy.' },
    { id: 'gemini-3.7-flash', name: 'Gemini 3.7 Flash', badge: 'Stable', description: 'Reliable previous-generation Flash model. Good fallback if 3.8 is unavailable.' },
    { id: 'gemini-3.5-flash-lite', name: 'Gemini 3.5 Flash Lite', badge: 'Lite', description: 'Lightweight and ultra-fast. Best for short meetings or low-latency note generation.' },
    { id: 'gemini-3.1-pro-preview', name: 'Gemini 3.1 Pro Preview', badge: 'Pro', description: 'Highest capability model for complex, lengthy, or multi-speaker technical discussions.' },
  ],
  // Google's auto-updating aliases: each always points at the newest release of its family.
  latestModels: [
    { id: 'gemini-flash-latest', name: 'Gemini Flash Latest', badge: 'Flash', description: 'Always the newest Flash model. Google swaps it on each release, so notes can change without a MeetMind update.' },
    { id: 'gemini-flash-lite-latest', name: 'Gemini Flash Lite Latest', badge: 'Lite', description: 'Always the newest Flash Lite model. Fastest and cheapest, for short meetings.' },
    { id: 'gemini-pro-latest', name: 'Gemini Pro Latest', badge: 'Pro', description: 'Always the newest Pro model. Most capable, for long or technical meetings.' },
  ],
  defaultModel: 'gemini-3.8-flash',
  allowCustomModel: true,
  // Retired model IDs saved in older configs, mapped to their replacements.
  _deprecatedModels: {
    'gemini-1.5-flash': 'gemini-3.5-flash-lite',
    'gemini-1.5-pro': 'gemini-3.5-flash-lite',
    'gemini-2.0-flash': 'gemini-3.5-flash-lite',
    'gemini-2.0-flash-thinking-exp': 'gemini-3.5-flash-lite',
    'gemini-3.1-flash-lite-preview': 'gemini-3.5-flash-lite',
    'gemini-3.1-flash-lite': 'gemini-3.5-flash-lite',
    'gemini-3-flash-preview': 'gemini-3.8-flash',
    'gemini-3-pro-preview': 'gemini-3.8-flash',
    'gemini-3.6-flash': 'gemini-3.8-flash',
    'gemini-3.5-flash': 'gemini-3.8-flash',
  },
  generate,
  test,
};

export default provider;
