# Adding a speech-to-text or LLM provider

Every engine is one self-describing module. The Settings screens, key checks, connection tests and config keys are all generated from the module, so nothing else needs to change.

## Steps

1. **Create the module** in `electron/providers/stt/<name>.ts` (transcription) or `electron/providers/llm/<name>.ts` (note generation). Copy `stt/groq.ts` or `llm/groq.ts` as a starting point. A provider is a plain object typed `STTProvider` or `LLMProvider` (`electron/shared/providers.ts`) and `export default`ed, so tests can `vi.spyOn` its functions.
2. **Register it**: import it and add it to the list in `electron/providers/index.ts`.
3. **Add an icon** (optional) in `renderer/components/settings/providers/providerIcons.ts`, keyed by the descriptor's `icon` id. Without one, a generic icon is shown.
4. **Add a test** in `tests/providers.test.ts` that mocks `fetch` (the contract tests already cover descriptor shape).
5. **Bump the version and changelog** per `AGENTS.md`.

## Descriptor

Shared fields (both kinds):

| Field | Purpose |
| --- | --- |
| `id`, `name`, `badge`, `icon`, `pricing`, `description` | Card text in Settings |
| `credentials[]` | `{ configKey, label, type: 'password' \| 'text', placeholder, hint, link, required }`. Every `configKey` is stored in the config automatically. A key shared by two providers (for example `groqApiKey`) is declared in both. Extra options (a prompt, a project ID) are just non-required entries |
| `guide[]` | "How to get a key" steps: `{ text, url?, hint? }` |
| `models[]`, `defaultModel` | Curated `{ id, name, badge, description }` list and the default ID |
| `latestModels[]` | Optional auto-updating aliases (same shape as `models[]`, for example `gemini-flash-latest`). When set, Settings shows a Latest / Pinned / Custom toggle, and they are always accepted as a saved model |
| `allowCustomModel` | Show a free-text model ID field. For an LLM it sits behind a Pinned / Custom toggle (Latest / Pinned / Custom with `latestModels`) |
| `capabilities` | Optional, for example `{ diarization: false }` shows a hint in the UI |
| `test({ config, model })` | Throws if the credentials or model do not work |

Keys starting with `_` (for example `_deprecatedModels`) and functions stay in the main process and are never sent to the renderer.

STT only: `transcribe({ wavPath, model, config, onProgress })` returns `[{ speaker, text, startTime, endTime }]`. The silence check and progress scaling are handled by `services/transcription.ts`. For services with an upload limit, use `providers/shared/wav.ts` (`planChunks`, `extractWavChunkBuffer`, `mergeTranscriptSegments`).

LLM only: `generate({ systemPrompt, userPrompt, model, config, json, onText })` returns the raw model text. Fence stripping, JSON parsing, normalization and the fallback to another provider are handled by `services/notes.ts`. `json` is true in structured-notes mode. Stream the answer if the API can and call `onText(delta)` with each piece of text as it arrives; the meeting page uses it for a live preview. `onText` may be undefined, and a provider that can't stream just ignores it and still returns the full text.

## Rules

- Provider modules must not import `electron` or `electron-store` at load time (require heavy SDKs lazily inside functions) so they can be unit-tested. Use `providers/shared/log.ts` instead of `utils/logger`.
- Use `providers/shared/http.ts` (`fetchJson`, or `httpError` for a streamed response's non-2xx status) so errors carry `.status` and `.retryAfterMs`. Read a server-sent-events stream with `readEvents` from `providers/shared/sse.ts`.
- An LLM must throw, not return, when its output is incomplete (cut off at the token limit, refused), so `services/notes.ts` can try the fallback.
- Never log API keys.
