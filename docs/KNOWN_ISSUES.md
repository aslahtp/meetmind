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
