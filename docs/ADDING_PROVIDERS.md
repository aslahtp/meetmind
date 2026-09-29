# Adding a speech-to-text or LLM provider

Every engine is one self-describing module. The Settings screens, key checks, connection tests and config keys are all generated from the module, so nothing else needs to change.

## Steps

1. **Create the module** in `electron/providers/stt/<name>.js` (transcription) or `electron/providers/llm/<name>.js` (note generation). Copy `stt/groq.js` or `llm/groq.js` as a starting point.
2. **Register it** with one line in `electron/providers/index.js`.
3. **Add an icon** (optional) in `renderer/components/settings/providers/providerIcons.js`, keyed by the descriptor's `icon` id. Without one, a generic icon is shown.
4. **Add a test** in `tests/providers.test.js` that mocks `fetch` (the contract tests already cover descriptor shape).
5. **Bump the version and changelog** per `AGENTS.md`.

## Descriptor

Shared fields (both kinds):

| Field | Purpose |
| --- | --- |
| `id`, `name`, `badge`, `icon`, `pricing`, `description` | Card text in Settings |
| `credentials[]` | `{ configKey, label, type: 'password' \| 'text', placeholder, hint, link, required }`. Every `configKey` is stored in the config automatically. A key shared by two providers (for example `groqApiKey`) is declared in both. Extra options (a prompt, a project ID) are just non-required entries |
| `guide[]` | "How to get a key" steps: `{ text, url?, hint? }` |
| `models[]`, `defaultModel` | Curated `{ id, name, badge, description }` list and the default ID |
| `allowCustomModel` | Show a free-text model ID field |
| `capabilities` | Optional, for example `{ diarization: false }` shows a hint in the UI |
| `test({ config, model })` | Throws if the credentials or model do not work |

Keys starting with `_` (for example `_deprecatedModels`) and functions stay in the main process and are never sent to the renderer.

STT only: `transcribe({ wavPath, model, config, onProgress })` returns `[{ speaker, text, startTime, endTime }]`. The silence check and progress scaling are handled by `services/transcription.js`. For services with an upload limit, use `providers/shared/wav.js` (`planChunks`, `extractWavChunkBuffer`, `mergeTranscriptSegments`).

LLM only: `generate({ systemPrompt, userPrompt, model, config, json })` returns the raw model text. Fence stripping, JSON parsing, normalization and the fallback to another provider are handled by `services/notes.js`. `json` is true in structured-notes mode.

## Rules

- Provider modules must not import `electron` or `electron-store` at load time (require heavy SDKs lazily inside functions) so they can be unit-tested. Use `providers/shared/log.js` instead of `utils/logger`.
- Use `providers/shared/http.js` (`fetchJson`) so errors carry `.status` and `.retryAfterMs`.
- Never log API keys.
