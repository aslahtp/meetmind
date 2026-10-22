const fs = require('fs');
const { httpsGet } = require('../shared/http');
const { getWavDurationSeconds } = require('../shared/wav');

/**
 * Request options for a transcription. Universal-3.5 Pro detects the language itself, code-switching
 * across its 18 languages, and AssemblyAI hands audio in any other language to Universal-2 (the
 * second entry). `language_detection` can't be combined with `language_codes`, so only
 * Universal-2 keeps the fixed language list.
 */
function requestOptions({ wavPath, model, prompt }) {
  const options = { audio: wavPath, speaker_labels: true };
  if (model === 'universal-2') {
    options.speech_models = ['universal-2'];
    options.language_codes = ['en', 'ml'];
  } else {
    options.speech_models = ['universal-3-5-pro', 'universal-2'];
    options.language_detection = true;
  }
  if (typeof prompt === 'string' && prompt.trim()) options.prompt = prompt.trim();
  return options;
}

async function transcribeWithAssemblyAI(wavFilePath, apiKey, prompt, model, onProgress) {
  if (!apiKey || !apiKey.trim()) {
    throw new Error('AssemblyAI API key is required for transcription');
  }
  if (!fs.existsSync(wavFilePath)) {
    throw new Error(`Audio file not found: ${wavFilePath}`);
  }

  const { AssemblyAI } = require('assemblyai');
  const client = new AssemblyAI({ apiKey: apiKey.trim() });

  onProgress?.(0);

  const transcript = await client.transcripts.transcribe(requestOptions({ wavPath: wavFilePath, model, prompt }));

  onProgress?.(1);

  const segments = [];

  if (Array.isArray(transcript.utterances) && transcript.utterances.length > 0) {
    for (const utt of transcript.utterances) {
      const startSec = typeof utt.start === 'number' ? utt.start / 1000 : 0;
      const endSec = typeof utt.end === 'number' ? utt.end / 1000 : startSec;
      // AssemblyAI labels speakers "A", "B", …; store them as "Speaker A" like the other services.
      const speakerLabel = utt.speaker != null ? String(utt.speaker).trim() : '1';
      const speaker = /^([A-Z]|\d+)$/.test(speakerLabel) ? `Speaker ${speakerLabel}` : speakerLabel;

      segments.push({
        speaker,
        text: utt.text || '',
        startTime: startSec,
        endTime: endSec,
      });
    }
  } else if (transcript.text) {
    // Fallback: no utterances/speaker labels, but we still have text.
    segments.push({
      speaker: 'Speaker 1',
      text: transcript.text,
      startTime: 0,
      endTime: getWavDurationSeconds(wavFilePath) || 0,
    });
  }

  if (!segments.length) {
    throw new Error('No speech detected in the recording (AssemblyAI returned an empty transcript).');
  }

  return segments;
}

async function testAssemblyAI(apiKey) {
  if (!apiKey || !apiKey.trim()) {
    throw new Error('AssemblyAI API key is required');
  }
  const url = 'https://api.assemblyai.com/v2/account';
  const result = await httpsGet(url, { Authorization: apiKey.trim() });
  if (result && result.error) {
    throw new Error(result.error);
  }
}


module.exports = {
  id: 'assemblyai',
  name: 'AssemblyAI',
  badge: 'Universal-3.5 Pro',
  icon: 'assemblyai',
  pricing: 'Free tier available (100 hrs), then $0.37/hr',
  description:
    'Production-ready transcription with built-in speaker diarization and code switching between languages.',
  credentials: [
    {
      configKey: 'assemblyAiApiKey',
      label: 'AssemblyAI API key',
      type: 'password',
      placeholder: 'assemblyai_key_...',
      link: { href: 'https://www.assemblyai.com/dashboard', label: 'AssemblyAI dashboard' },
      required: true,
    },
    {
      configKey: 'assemblyAiPrompt',
      label: 'Transcription guidance / key terms (optional)',
      type: 'text',
      placeholder: 'e.g. Kubernetes, MeetMind, API tokens, speaker names…',
      hint: 'Custom domain terms, names, or languages that improve recognition accuracy.',
    },
  ],
  guide: [
    { text: 'Go to the AssemblyAI Dashboard', url: 'https://www.assemblyai.com/dashboard/signup' },
    { text: 'Sign up and copy your API key from the dashboard home' },
    { text: 'Paste it into the AssemblyAI API key field' },
  ],
  models: [
    { id: 'universal-3-5-pro', name: 'Universal-3.5 Pro', badge: 'Default', description: 'Highest accuracy, with code switching across 18 languages; other languages fall back to Universal-2 automatically.' },
    { id: 'universal-2', name: 'Universal-2', badge: 'Stable', description: 'Previous-generation multilingual model.' },
  ],
  // Not in the list, so a saved 'universal-3-pro' (the previous default) resolves to this one.
  defaultModel: 'universal-3-5-pro',
  allowCustomModel: false,
  capabilities: { diarization: true, languages: ['en', 'ml'] },
  transcribe: ({ wavPath, model, config, onProgress }) =>
    transcribeWithAssemblyAI(wavPath, config.assemblyAiApiKey, config.assemblyAiPrompt, model, onProgress),
  test: ({ config }) => testAssemblyAI(config.assemblyAiApiKey),
  _requestOptions: requestOptions,
};
