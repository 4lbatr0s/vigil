# ADR-0033: Each MCP client can have its own token

## Status
Accepted (2026-11-25). Amends ADR-0022 (MCP server) and ADR-0007 (access). Amended 2026-11-26: a client can have a write scope.

## Context
ADR-0022 lets other tools read and write notes over `POST /api/mcp`, behind the one `VIGIL_TOKEN`. Every connected tool shares that token. When a note changes, the run list says `mcp` and nothing more, so the owner cannot tell Claude Code from Claude Desktop from a script, and cannot cut one off without changing the token for all of them (and for the web app).

## Decision
- The owner can create **MCP clients** in Settings, each with a name (for example "claude-desktop"). Creating one shows a token once. Vigil stores only a SHA-256 hash of it, the name, the creation time and the time it was last used.
- A client token is accepted **only on `POST /api/mcp`**. On every other route it is refused like a wrong token. The global `VIGIL_TOKEN` and the web session keep working everywhere, including on `/api/mcp`.
- A write made with a client token is a run as before (`agent: mcp`, `trigger: mcp`), and the run log carries a first line `written by MCP client "<name>"`. A call that uses the global token, or no token, is logged without a name.
- The owner can revoke a client at any time; its token stops working at once. Revoking does not undo what it wrote (the run's undo does).
- The existing limits (30 writes per minute across all clients, body size, tool output size) stay. Switching MCP off in Settings stops every client.
- **Write scope (2026-11-26):** a client can be created with tags ("Only write notes tagged"). Its writes then follow the same rule as an agent's `writeTags`: a change to an existing note needs one of the tags on that note, a new note needs one in its body, anything else is refused and nothing is written. The scope is set when the client is created; to change it, create a new client and revoke the old one. The global token and the web session have no scope.

## Consequences
- The run list can tell clients apart, and one leaked client token can be revoked without touching the others or the web login. It reaches only `/api/mcp`, so it cannot read settings, connections or agent definitions.
- A token is a bearer secret: anyone who has it can use MCP while it is switched on. It is shown once and never logged or returned again. A lost token is replaced by creating a new client.
- The per-minute write limit is still shared, so one noisy client can use up the others' budget. Per-client limits are not built.
- A client given a scope can no longer change notes outside it, so a token for a tool that keeps a journal cannot rewrite the rest of the vault. Reads are not limited.
