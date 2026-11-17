# ADR-0021: Pasted images live in the vault

## Status
Accepted (2026-11-17).

## Context
Learners paste screenshots and diagrams into notes. Markdown stays the source of truth (ADR-0001), so images must travel with the vault and show in any markdown viewer. Uploading files is a new trust boundary (see threat model T19).

## Decision
- A paste or drop of a PNG, JPEG, GIF or WebP image uploads the raw bytes to `POST /api/attachments`. The file is written to `attachments/<16 hex of its SHA-256>.<ext>` inside the vault, so the same picture twice is one file. The note gets `![](attachments/<name>)`, a relative link that Obsidian and other viewers also resolve.
- The type comes from the file's first bytes, never from the client's claim. SVG is refused because it can carry script. The cap is 5 MB, enforced while streaming.
- Reads (`GET /api/attachments/<name>`) accept only names of that exact shape, and answer with `nosniff` and a sandboxed `default-src 'none'` policy.
- The editor shows our own pictures in place of their markdown while the cursor is elsewhere; the preview renderer rewrites the relative link to the API address. Other image links are left as they are (and the page policy only loads same-origin images).
- The vault listing and watcher only read top-level `.md` files, so the folder never shows up as notes.

## Consequences
- Pictures are not deleted when a note is deleted or a link is removed. Settings, Pictures lists those no note links to (over an hour old, so a fresh paste is safe) and deletes them after a confirm.
- Pictures are not yet included in agent prompts; agents read note text only.
- Snapshots and undo cover note text, not pictures.
