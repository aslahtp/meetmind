---
tags: [meta, changelog]
updated: 2026-08-13
---
# Changelog

Chronological log of notable changes to the project. Newest first. This is a human-curated log — not a mirror of `git log`.

## v1.5.0

- **Automated GitHub Actions CI/CD Release Pipeline** — added `.github/workflows/release.yml` workflow that automatically triggers on `package.json` version bump, compiles Windows installer (`.exe`), NSIS blockmap (`.blockmap`), and Chrome extension zip (`meetmind-extension.zip`), and publishes them to GitHub Releases.
- **Templated Release Description Integration** — workflow dynamically populates `.github/release_template.md` with version placeholders (`{VERSION}`, `x.y.z`) and extracted changelog entries (`{CHANGELOG_BODY}`) for rich release notes on GitHub.
- **Cross-Platform Extension Packaging** — updated `scripts/build-extension.js` with cross-platform fallback support (`powershell` on Windows, `zip` on Linux/macOS).
- **Automated Version & Changelog Rule** — added learned workflow rule in `AGENTS.md` requiring package version bumps and `CHANGELOG.md` updates for all moderate to major changes.

## v1.4.0


- **Executive Assistant Markdown Prompt** — default system prompt for Markdown output mode configured with a 10+ year Executive Assistant & Documentation Specialist prompt structure (Header, Executive Summary, Key Discussion Points, Key Decisions, Action Items table, Next Steps).
- **Dual Output Mode (JSON / Markdown)** — toggle pill in Settings (`JSON` / `Markdown`) allowing choice between structured JSON and prose Markdown notes. Persisted in `electron-store` schema and `config.js` (`noteOutputMode`).
- **Rich Prose Markdown Viewer** — auto-detects `_rawMarkdown` in `NoteViewer.jsx` and renders full markdown with custom HTML tables, multi-level nested sub-bullets, checklist task items, blockquote cards, inline bold/italic/links/code, and top header metadata badges (`JSON` / `Markdown`).
- **Native Notion API Markdown Upload** — converts raw markdown notes directly into native Notion page blocks, native Notion `table` / `table_row` blocks, nested `bulleted_list_item` children trees, and rich_text annotations for inline formatting (`parseMarkdownRichText`).
- **Smart Transcript Reuse** — `runProcessingPipeline` checks for an existing session transcript in SQLite to prevent re-triggering Speech-to-Text API calls when notes generation fails or is retried.

## v1.3.0

- **Multi-Service STT & Gemini Integration** — added AssemblyAI and Sarvam AI (native Malayalam-English code-switching) Speech-to-Text providers, dynamic Gemini model selector (`gemini-3.6-flash`, `gemini-3.5-flash-lite`, etc.), WASAPI audio device probing, and API connection testing in Settings.
- **Onboarding Guide & UI Integration** — step-by-step API setup guide accordion in Settings for Google Cloud, Sarvam AI, AssemblyAI, Gemini, and Notion.