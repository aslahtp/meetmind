const { GoogleGenerativeAI } = require('@google/generative-ai');
const logger = require('../utils/logger');

const AVAILABLE_MODELS = [
  'gemini-3.6-flash',
  'gemini-3.5-flash',
  'gemini-3.5-flash-lite',
  'gemini-3.1-flash-lite',
  'gemini-3.1-pro-preview',
];

const DEFAULT_GEMINI_MODEL = 'gemini-3.5-flash-lite';

function resolveModelId(modelId) {
  if (modelId && AVAILABLE_MODELS.includes(modelId)) return modelId;
  return DEFAULT_GEMINI_MODEL;
}

const SYSTEM_PROMPT = `You are an expert meeting notes assistant.

Given a meeting transcript (possibly with speaker labels), generate structured meeting notes in JSON format that will be rendered as:
- A top section called "Action Items & Next Steps" in todo/checklist form
- Below that, several section headings (Key discussion areas) with bullet points under each heading

The transcript may contain a mix of English and Malayalam (or other languages). Understand all languages present and generate the output entirely in English regardless of the transcript language.

Return ONLY valid JSON with this exact schema (no extra text, no markdown, no emojis):
{
  "title": "Meeting title inferred from context",
  "action_items": [
    {
      "task": "todo-style task description with no emojis or markdown with mentioning of the task owner if possible",
    }
  ],
  "key_points": [
    {
      "heading": "Short, descriptive topic heading (no emojis)",
      "summary": "Bullet-style lines describing this topic. Use plain text only, no emojis or markdown. To express multiple bullets under this heading, separate each bullet with a newline character (\\n)."
    }
  ],
}

Rules:
- The transcript may be in Malayalam, English, or a mix of both. Always generate the JSON output in English.
- Don't use speaker labels like "Speaker 1", "Speaker 2", etc. Instead, if you can find the speaker's name in the transcript, use it for owner attribution.
- If a speaker's actual name is not available, use "Team" as the owner.
- Action items MUST come from explicit commitments, not guesses.
- Make action_items.task concise, and never include emojis, checkboxes, or markdown.
- key_points.heading should be concise, human-readable section titles that can be used as headings in the UI and Notion.
- key_points.summary should be written so that splitting on newlines (\\n) yields individual bullet lines. Each line must stand alone as a readable point. Do NOT include bullet characters (-, *, •) or emojis; just plain sentences.
- Never include emojis anywhere in the JSON.
- Be concise but complete — every important point must appear.
- Return ONLY the JSON object, no markdown, no explanation.`;

function transcriptToText(transcript) {
  if (!Array.isArray(transcript) || transcript.length === 0) {
    return 'No transcript available.';
  }

  return transcript
    .map((seg) => {
      const time = formatTime(seg.startTime || 0);
      return `[${time}] ${seg.speaker || 'Speaker'}: ${seg.text}`;
    })
    .join('\n');
}

function formatTime(seconds) {
  const m = Math.floor(seconds / 60).toString().padStart(2, '0');
  const s = Math.floor(seconds % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

async function generateMeetingNotes(transcript, modelId, apiKey) {
  if (!apiKey) throw new Error('Gemini API key is required');

  const selectedModel = resolveModelId(modelId);
  const transcriptText = transcriptToText(transcript);

  logger.info('Generating meeting notes', { modelId: selectedModel, transcriptLength: transcriptText.length });

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: selectedModel,
    systemInstruction: SYSTEM_PROMPT,
  });

  const prompt = `Here is the meeting transcript:\n\n${transcriptText}\n\nGenerate structured meeting notes in JSON format as specified.`;

  const result = await model.generateContent(prompt);
  const text = result.response.text().trim();

  // Strip markdown code fences if present
  let jsonText = text;
  if (jsonText.startsWith('```')) {
    jsonText = jsonText.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
  }

  try {
    const notes = JSON.parse(jsonText);
    logger.info('Meeting notes generated', {
      title: notes.title,
      actionItems: notes.action_items?.length || 0,
      keyPoints: notes.key_points?.length || 0,
    });
    return notes;
  } catch (err) {
    logger.error('Failed to parse Gemini JSON response', { error: err.message, text: jsonText.slice(0, 200) });
    // Return a safe fallback structure
    return {
      title: 'Meeting Notes',
      date: new Date().toISOString(),
      duration: 'Unknown',
      attendees: [],
      action_items: [],
      key_points: [{ heading: 'Summary', summary: jsonText.slice(0, 500) }],
      decisions: [],
      questions_unresolved: [],
      next_meeting: null,
      sentiment: 'neutral',
      _rawResponse: jsonText,
    };
  }
}

async function testGeminiConnection(apiKey, modelId) {
  if (!apiKey) throw new Error('Gemini API key is required');
  const genAI = new GoogleGenerativeAI(apiKey);
  const modelToUse = resolveModelId(modelId);
  const model = genAI.getGenerativeModel({ model: modelToUse });
  const result = await model.generateContent('Reply with "OK" only.');
  const text = result.response.text();
  if (!text) throw new Error('No response from Gemini API');
}

function getAvailableModels() {
  return AVAILABLE_MODELS;
}

module.exports = {
  generateMeetingNotes,
  getAvailableModels,
  testGeminiConnection,
  AVAILABLE_MODELS,
  DEFAULT_GEMINI_MODEL,
};
