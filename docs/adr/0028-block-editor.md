# ADR-0028: A block editor on Tiptap, with markdown files as the source of truth

## Status
Accepted (2026-11-18). Replaces the Live Preview editor as the default; that editor stays as the plain markdown mode.

## Context
The note editor was CodeMirror 6 with a Live Preview that hides markdown marks away from the caret (the way Obsidian does it). After two rounds of polish it still read as a text editor, not as a writing surface like Notion: tables were lined-up pipes, task boxes were native squares, there were no real blocks to grab, and nothing hid the markup. A source editor that hides syntax cannot close that gap, because the feel comes from a document made of blocks that draw as widgets (grid tables, callouts, drag handles).

## Decision
- **Engine:** Tiptap 3 (ProseMirror), core classes only and a thin Svelte wrapper (`BlockEditor.svelte`). Chosen over BlockNote and Novel (React only), and Milkdown (smaller community, harder custom nodes). Packages are pinned exactly.
- **Markdown stays the file format.** Notes are plain `.md` files (ADR-0001); the editor reads markdown with `@tiptap/markdown` and writes it back. There is no block JSON on disk.
- **Fidelity gate.** Before a note opens as blocks, `roundTrips()` parses it, writes it back, and compares the two after a small normalisation (blank-line runs, table padding, bullet style; code is compared exactly; added backslash escapes are not ignored). If they differ (footnotes, raw HTML, comments, anything the block editor would change or drop) the note opens in the plain markdown editor with a one-line reason, and nothing is rewritten. A note is written back only when the person edits it. A Markdown / Blocks switch moves either way.
- **Custom nodes** that write back exactly as typed: `[[wikilink|label]]`, `{{c1::cloze}}`, and callouts (`> [!note]- Title`, with a foldable body). Tags are drawn as pills by a decoration only; the text is not changed. Pictures keep their `attachments/<name>` path in the markdown and are shown from the server.
- **Interactions:** a grouped `/` menu with icons, a `[[` note picker, a plus and grip beside every block (drag to move, click for turn into, duplicate, move, delete), Alt+Up/Down, a floating format bar, table row and column controls, an outline list. Block moves are pure position maths (`blocks/moves.ts`) with tests.
- **Code colours** come from the existing `--code-*` tokens through highlight.js classes. Only 15 common languages are registered (all of them would add about 80 KB gzip); other languages show as plain code.
- **Weight:** the editor is a lazy chunk; first load stays about 100 KB gzip. The block editor chunk is about 210 KB gzip; the CodeMirror editor now loads only when a note opens as markdown.

## Consequences
- Notes with syntax the block editor cannot keep open as markdown. That is by design and shown to the person.
- The editor rewrites a note's markdown in its own style on the first edit (aligned table columns, `*` for emphasis as marked writes it). The gate guarantees the words and blocks are the same.
- Not built yet: folding headings, hover preview of `[[wikilinks]]`, `![[note]]` embeds, `#tag` completion, find and replace inside the editor (the browser's find works), columns (no markdown form), a focus mode, and a phone layout.
