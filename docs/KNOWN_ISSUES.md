# Known issues

Bugs we know about but haven't fixed yet. Each entry says what happens, who it affects, why, and how to avoid it until it's fixed. Remove an entry in the same change that fixes it.

---

## Code blocks in structured-note list sections turn into list items

**Affects:** editing structured (JSON-mode) notes in the Summary tab's Markdown editor. Markdown-mode notes are not affected, because they're saved as the text you typed.

### What happens

Saving an edit converts the Markdown back into structured notes. If a code block sits inside a list section, each `- ` line in the block becomes a separate item, and the block itself is dropped. For example:

````markdown
## Action Items
- [ ] Update the deploy script (@Ravi)

```
- run migrations
- restart workers
```
````

After saving, the meeting has three action items instead of one:

- Update the deploy script (owner: Ravi)
- run migrations
- restart workers

The extra items then show up everywhere the notes go: the Summary cards, Copy as Markdown, PDF export and Notion.

The same happens in:

- **Participants** (fenced lines become fake participants)
- **Notable Mentions**
- a topic's **Options Discussed** and **Open Questions** lists

Code blocks in a topic's body text are kept correctly.

### Why

`parseNotesMarkdown` in `renderer/components/note/copyMarkdown.js` parses in two steps. `splitSections` splits the text into `## ` sections and skips headings inside code fences, so a fenced `## Participants` stays text. Then `listItems` (and the list handling in `parseTopic`) takes every line matching `- ` in a section. That second step checks each line on its own and never tracks whether it's inside a fence.

### Workaround

Don't put code blocks under Action Items, Participants, Notable Mentions, or a topic's option and question lists. Put them in a topic's body text, or under a heading of your own (for example `## Snippets`), which is saved as an extra topic with its text intact.

### Fix

Track ``` / `~~~` fences in `listItems` and in `parseTopic`'s list modes, and skip list lines inside a fence. Those sections have no field for a code block, so the block would still be dropped, but it would no longer create items. Add a case to `tests/copyMarkdown.test.js` covering a fenced list under Action Items. This changes what saving an edit produces, so give it a changelog entry.

---

## Intel Mac FFmpeg source ends in January 2027

**Affects:** macOS releases (the Intel DMG and, through it, the whole release) and the in-app FFmpeg download on Intel Macs. Windows and Apple silicon downloads are not affected by this source change, but a failed Intel download still blocks the whole release.

### What happens

The macOS FFmpeg builds come from [ffmpeg.martin-riedl.de](https://ffmpeg.martin-riedl.de/), pinned by URL and SHA-256 in `electron/audio/ffmpeg-sources.js`. The site says its macOS Intel (amd64) release builds stop in January 2027. It doesn't say whether existing files stay online.

- **If the pinned Intel files are removed:** `scripts/fetch-ffmpeg.js` fails in the `build-mac` job of `release.yml`, and because `publish` needs both build jobs, no release (Windows included) is published. The in-app **Download & Install FFmpeg** (and post-update **Repair now**) fails for Intel Mac users.
- **If they stay online:** nothing breaks, but there is no newer Intel build to move to, so Intel users stay on FFmpeg 9.0.2 (no security fixes) unless another source is found.

### Why

Every pinned download is fetched from a third-party host at build and install time, and the Intel pins point at builds the host is retiring. The SHA-256 check guarantees the files can't be swapped, not that they stay available.

### Workaround

None needed until the files disappear. If a release fails at **Download FFmpeg Binaries** with an HTTP 404 for an `amd64` URL, apply the fix below.

### Fix

Before January 2027, mirror the two pinned Intel zips (`.../macos/amd64/1789931006_9.0.2/ffmpeg.zip` and `ffprobe.zip`) somewhere MeetMind controls, for example as assets of a dedicated GitHub release in this repo (tag `ffmpeg-mac-x64-9.0.2`), and point the two `x64` URLs in `electron/audio/ffmpeg-sources.js` at the mirror. Keep the SHA-256 values unchanged: the files are byte-for-byte the same, so the existing checksum check still proves they weren't altered. Link the matching FFmpeg source from that release, as FFmpeg's LGPL/GPL licence expects of anyone redistributing the binaries (which the DMGs already do). Longer term, Apple's macOS 26 is the last release for Intel Macs, so dropping the Intel DMG may eventually be simpler than keeping its FFmpeg current. Changing the URLs changes where the app downloads from, so give it a changelog entry.
