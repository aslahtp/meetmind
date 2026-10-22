async function generate({ systemPrompt, userPrompt, model, config, onText }, deps = {}) {
  const apiKey = config.geminiApiKey;
  if (!apiKey) throw new Error('Gemini API key is required');

  const { GoogleGenerativeAI } = deps.sdk || require('@google/generative-ai');
  const genModel = new GoogleGenerativeAI(apiKey).getGenerativeModel({
    model,
    systemInstruction: systemPrompt,
  });
  const result = await genModel.generateContentStream(userPrompt);
  let text = '';
  for await (const chunk of result.stream) {
    const delta = chunk.text();
    text += delta;
    if (delta) onText?.(delta);
  }
  return text.trim();
}

async function test({ config, model }) {
  const apiKey = config.geminiApiKey;
  if (!apiKey) throw new Error('Gemini API key is required');

  const { GoogleGenerativeAI } = require('@google/generative-ai');
  const genModel = new GoogleGenerativeAI(apiKey).getGenerativeModel({ model });
  const result = await genModel.generateContent('Reply with "OK" only.');
  if (!result.response.text()) throw new Error('No response from Gemini API');
}

module.exports = {
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
