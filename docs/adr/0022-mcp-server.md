# ADR-0022: Vigil speaks MCP so other agents can work in the vault

## Status
Accepted (2026-11-17). Amended by ADR-0033 (named client tokens).

## Context
Vigil is where the learner's notes and study memory live. People already work with other AI tools (Claude Code, Claude Desktop, editors) that speak the Model Context Protocol (MCP). Letting those tools read and write notes makes the vault useful beyond our own agents, but it adds a second way in, so it needs the same protection as the first (snapshots, undo, token, Host and Origin checks).

## Decision
- One route, `POST /api/mcp`, speaks MCP over HTTP with plain JSON replies (Streamable HTTP transport, no streaming; a batch of up to 20 messages is allowed). Methods: `initialize`, `ping`, `tools/list`, `tools/call`; notifications get `202`. The route sits under `/api/`, so the existing Host, Origin and `VIGIL_TOKEN` checks apply unchanged.
- It is **off** until the owner switches it on in Settings (`GET/PUT /api/mcp/settings`, stored in the settings table). Writing is a second switch and cannot be on while MCP is off.
- Tools: `search_notes`, `read_note`, `list_notes`, `learner_status` (the same implementations the built-in agents use, via `buildTools`), and `write_note` only when write is on.
- Every `write_note` call is its own run (`agent: mcp`, `trigger: mcp`) with the usual snapshot, so it appears in the run list and "Undo this run" restores the note, with the same refusal if the owner edited it since. There is no approvals step: the owner already chose to allow writes, and strict mode applies to Vigil's own agents.
- Limits: 30 writes per minute, 200,000 characters per body, tool output capped like agent tool output (8,000 characters), 2 MB request body.
- No dependency on an MCP SDK; the small subset above is written by hand and tested. stdio transport is not offered (a desktop client that only speaks stdio can use an HTTP-to-stdio bridge).

## Consequences
- A connected agent can write bad text into notes; undo and the per-minute cap limit the damage (threat model T20).
- Notes are untrusted data for the connected agent; Vigil cannot stop that agent obeying a malicious note, only limit what it can reach (read, and optionally write notes; no shell, no network, no other routes).
- Without `VIGIL_TOKEN` on a loopback bind, any local process can call the route once it is switched on, as with the rest of the API (ADR-0007).
