# Contributing to MeetMind

Thanks for helping improve MeetMind. Bug reports, feature ideas, documentation fixes and pull requests are all welcome.

## Reporting bugs and requesting features

- Search [existing issues](https://github.com/aslahtp/meetmind/issues) first.
- Use the **Bug report** or **Feature request** template when opening a new issue.
- For bugs, include your MeetMind version (Settings → System), Windows version, the speech-to-text engine you use, and relevant lines from the in-app **Logs** page. Remove API keys and meeting content before posting.
- Report security vulnerabilities privately; see [SECURITY.md](SECURITY.md).

## Development setup

MeetMind is a Windows-only Electron app. You need Windows 10/11, Node.js 22.12+ and [pnpm](https://pnpm.io/) (never npm or npx).

```bash
git clone https://github.com/aslahtp/meetmind.git
cd meetmind
pnpm install
pnpm run dev
```

[AGENTS.md](AGENTS.md) describes the architecture (main process, renderer, processing pipeline, persistence, extension bridge) and every available command.

## Making changes

- Run `pnpm run lint` and `pnpm run test` before opening a PR. The tests cover pure logic only, so also verify a change by running the app with `pnpm run dev` and exercising the affected flow.
- Before changing any UI, read [DESIGN.md](DESIGN.md); it defines MeetMind's visual language and component patterns.
- For any change beyond a typo or formatting fix, bump `version` in `package.json` using semantic versioning and add an entry to [CHANGELOG.md](CHANGELOG.md) in the same pull request. The rules are in [AGENTS.md](AGENTS.md#versioning-and-changelog).
- Do not commit FFmpeg binaries, `package-lock.json`, `.env` files or API keys.

## Pull requests

1. Fork the repository and create a branch from `main`.
2. Keep each pull request focused on one change.
3. Describe what changed, why, and how you tested it; include screenshots for UI changes.
4. Make sure `pnpm run build:dir` still succeeds if you touched packaging or the main process.
5. CI must pass: lint, tests, build, secret scan, dependency audit, CodeQL, and the version/changelog check. For comment- or formatting-only changes, a maintainer can add the `skip-version-check` label.
6. If this is your first PR, a maintainer approves the CI run before it starts. Changes to `.github/`, `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `electron-builder.yml` or `scripts/` need maintainer review (see `.github/CODEOWNERS`). Pin any new GitHub Action to a full commit SHA, and add dependencies with `pnpm add`, which refuses versions less than a day old; see [AGENTS.md](AGENTS.md#cicd).

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE) and that you will follow the [Code of Conduct](CODE_OF_CONDUCT.md).
