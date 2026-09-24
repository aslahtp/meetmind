# Security Policy

## Supported versions

Only the [latest release](https://github.com/aslahtp/meetmind/releases/latest) of MeetMind receives security fixes. The app checks for updates from GitHub Releases in **Settings → System**.

## Reporting a vulnerability

Please do not open a public issue for security problems. Report them privately through [GitHub's vulnerability reporting](https://github.com/aslahtp/meetmind/security/advisories/new) with:

- the affected version and component (desktop app, Chrome extension, or build/release pipeline),
- steps to reproduce, and
- the impact you observed.

You should get an acknowledgement within a few days. Once a fix is released, the advisory will be published with credit to the reporter unless you prefer to stay anonymous.

## Scope

MeetMind stores API keys and meeting data locally and exposes a WebSocket server on `127.0.0.1` (ports 39842–39852) that only accepts `chrome-extension://` origins. Issues in these areas, in the Chrome extension, or in how audio and transcripts are sent to third-party providers are in scope. Vulnerabilities in the third-party services themselves (AssemblyAI, Google Cloud, Sarvam AI, Gemini, Notion) should be reported to those vendors.
