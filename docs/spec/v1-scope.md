# Vigil — v1 Scope (frozen 2026-11-14)

Vigil is a self-hosted, single-user notes app where AI agents are first-class citizens: agents read, write, and run on schedules (cron jobs, heartbeats, chat). Notes are where agents live; agents are the product.

## Locked decisions
1. Niche: useful AI agents — scheduled, heartbeat, chat — living in your notes. Agentic-centered product, notes-first foundation quality.
2. Persona: self-hosting AI tinkerer. The product presents both self-hosted and cloud; cloud = phase 2, same codebase.
3. Shape: self-hosted web server; browser + installable PWA. Native desktop (Tauri) and mobile = v2.
4. Storage: markdown files on disk are the source of truth; SQLite is a disposable index (full-text search, backlinks, graph edges) rebuilt by a file watcher.
5. Editor: live-preview markdown (CodeMirror 6). Never a block database.
6. Users: strictly single-user in v1.
7. Agents: one runtime, three archetypes — chat, scheduled (cron), heartbeat. Agent-to-agent talk via bounded call_agent (nesting depth 1, per-run token budget). One-click agent templates.
8. AI access: BYOK — any OpenAI-compatible base URL + key, plus native Ollama. No bundled AI service.
9. Agent tools (v1): read notes, write notes, web fetch (GET only). Per-agent tool allowlists. No shell, no arbitrary network.
10. Agent writes: free by default + automatic snapshot before every agent write (one-click undo) + run log. Optional per-agent strict mode = approve-before-write queue.
11. Flagship demo: the Morning Digest agent — cron at 07:00, reads yesterday's notes, writes a digest note.
12. Graph: Sigma.js; notes as nodes; plain link edges + dashed agent↔note edges; amber glow by recency.
13. Stack: TypeScript monorepo — apps/web (SvelteKit 2 + Svelte 5), apps/server (Node), packages/shared (zod types). CodeMirror 6. better-sqlite3 (plain SQL; Drizzle dropped, see ADR-0008). node-cron in-process. Single Docker image, one volume for the vault.

## v1 cuts (deliberate)
Native desktop/mobile apps (v2), plugin system, sharing/collaboration, multi-vault, theme marketplace, billing, Notion-style databases.

## Distribution
Public GitHub repo, AGPL-3.0. GitHub is the distribution channel; the README leads with the Morning Digest demo.
