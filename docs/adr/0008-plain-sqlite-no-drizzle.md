# ADR-0008: Plain better-sqlite3, versioned disposable index (amends v1 scope item 13)

## Status
Accepted (2026-11-14)

## Context
The v1 scope named Drizzle for the SQLite layer. The index is disposable (ADR-0001): it holds notes, a full-text table, links and, later, runs. The central table is an FTS5 virtual table, which Drizzle does not model, so it needs raw SQL anyway. Drizzle's migrations solve a problem this index does not have, because any schema change can drop the index and rebuild it from the vault.

## Decision
- Use `better-sqlite3` with plain SQL. No ORM in v1.
- The index schema carries a version (`PRAGMA user_version`). When the stored version differs from the code's `SCHEMA_VERSION`, the server drops the index tables and rebuilds them from the vault on start.
- State that is NOT derived from files (agent definitions, run logs, strict-mode queue, snapshots index) does not get the drop-and-rebuild treatment. When M1 adds the first such table, it gets real, additive migrations in a separate database file (`data/state.db`), and this ADR is revisited to decide whether that file justifies a query builder.

## Consequences
- Fewer dependencies, and SQL stays visible where FTS5 matters.
- Every index schema change costs one rebuild on the next start; fine for a personal vault, to be measured if vaults reach tens of thousands of notes.
- Run logs must never be stored in the disposable index file.
