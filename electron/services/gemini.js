const { GoogleGenerativeAI } = require('@google/generative-ai');
const logger = require('../utils/logger');

const AVAILABLE_MODELS = [
  { id: 'gemini-3.1-flash-lite-preview',label: 'Gemini 3.1 Flash Lite (Fast)'},
  { id: 'gemini-3-flash-preview',label: 'Gemini 3 Flash (Balanced)'},
  { id: 'gemini-3-pro-preview',label: 'Gemini 3 Pro (pro)'},
  { id: 'gemini-3.1-pro-preview',label: 'Gemini 3.1 Pro (Experimental)'},
];

const SYSTEM_PROMPT = `You are an expert meeting notes assistant inspired by Notion AI.

Given a meeting transcript (possibly with speaker labels), generate structured meeting notes in JSON format.

Return ONLY valid JSON with this exact schema:
{
  "title": "Meeting title inferred from context",
  "date": "ISO date string",
  "duration": "estimated duration string",
  "attendees": ["name or Speaker 1", "..."],
  "action_items": [
    {
      "task": "Clear, specific task description",
      "owner": "Person responsible (or 'Team' if unclear)",
      "due": "Due date if mentioned, else null",
      "priority": "high | medium | low"
    }
  ],
  "key_points": [
    {
      "heading": "Short topic heading",
      "summary": "2-3 sentence summary of what was discussed"
    }
  ],
  "decisions": ["Decision made, stated clearly"],
  "questions_unresolved": ["Open question that was not resolved"],
  "next_meeting": "Next meeting info if mentioned, else null",
  "sentiment": "positive | neutral | mixed | tense"
}

Rules:
- Action items MUST come from explicit commitments, not inferences
- Prioritize action_items by urgency — high if deadline mentioned
- key_points should cover all major topics in order discussed
- Be concise but complete — every important point must appear
- If a speaker label is available, use it for owner attribution
- Return ONLY the JSON object, no markdown, no explanation`;

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

  const selectedModel = modelId || AVAILABLE_MODELS[0].id;
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
  const modelToUse = modelId || AVAILABLE_MODELS[0].id;
  const model = genAI.getGenerativeModel({ model: modelToUse });
  const result = await model.generateContent('Reply with "OK" only.');
  const text = result.response.text();
  if (!text) throw new Error('No response from Gemini API');
}

function getAvailableModels() {
  return AVAILABLE_MODELS;
}

module.exports = { generateMeetingNotes, getAvailableModels, testGeminiConnection, AVAILABLE_MODELS };
