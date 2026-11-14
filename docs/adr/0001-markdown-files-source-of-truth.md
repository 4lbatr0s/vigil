# ADR-0001: Markdown files are the source of truth; SQLite is a disposable index

## Status
Accepted (2026-11-14)

## Context
Vigil must be Obsidian-compatible, greppable, backup-friendly, and lock-in-free. A database as source of truth would fight all four. Agents also need plain file access.

## Decision
Notes live as markdown files in a vault directory on disk. SQLite is a derived index (full-text search, backlinks, graph edges, schedules) rebuilt from the files by a file watcher. The index may be deleted and rebuilt at any time without data loss.

## Consequences
- File I/O and parsing become the server's foundation; every note mutation writes a file first, then updates the index.
- No transactions spanning multiple notes; consistency comes from the watcher reconciling files to index.
- Frontmatter is metadata (id, title, tags, author); the index parses it, files still open cleanly in Obsidian. A file with no frontmatter is valid: the title falls back to the first heading, then the file name.
- A note's `updatedAt` is the file's modification time, never a stored field, so edits made outside the API (agents, Obsidian) count. Files are written atomically (temp file, then rename), and a save that carries a stale `updatedAt` is refused with 409.
- The vault is flat in v1 (no subfolders); see the roadmap.
