# ADR-0015: Product defaults: env-only keys, soft cap, owner-controlled permissions, templates

## Status
Accepted (2026-11-15), confirmed by the owner. Guiding rule from the owner: performance and usability balance is everything; where two options tie, pick the faster and more usable one.

## Context
Several small decisions shape v1 behavior and would otherwise be made ad hoc by whoever implements them.

## Decision
1. **Keys are environment-only.** `VIGIL_LLM_API_KEY` is read from the server environment. The UI shows only whether a key is set. No key entry field, no key stored in the vault, state database or browser. A server-side secrets file written from the UI is post-v1.
2. **Soft monthly cap is a warning only.** `VIGIL_MONTHLY_TOKEN_CAP` drives `GET /api/usage`'s `level` (`ok`, `warn` at 80%, `over` at 100%). It never blocks or alters a run. The per-run token budget is the hard control.
3. **The owner configures agent permissions from a configuration page** (Settings > Permissions). Two layers: **instance switches** (read notes, write notes, fetch web pages, call other agents; off means unavailable to every agent), a default for approvals on new agents (`newAgentsStrict`, default on), a ceiling on any run's token budget (`maxTokenBudget`), and the retention period for run history (`retentionDays`, default 90). **Per-agent** grants, allowed hosts, callable agents, approvals and budget live on the agent page. The effective permission is the intersection (agent grant AND instance switch). The API forces nothing; the UI warns when an agent can read notes and fetch the web while approvals are off.
4. **Chat for every agent.** Any agent can be chatted with; chat uses the agent's tools, approvals and system prompt plus an optional `archetypeHint`, with a per-turn budget equal to its `tokenBudget`.
5. **Five templates ship, and none runs until the owner turns it on.** Morning Digest (the flagship and README demo), Weekly Review, Inbox Triager, Backlink Gardener, Research Scout. Adding a template creates the agent switched off; the agent page opens with a "Turn on" panel that states the schedule and permissions in plain words. Run now works on a switched-off agent. Agents that edit existing notes or fetch the web start with approvals on when `newAgentsStrict` is on.
6. **The Morning Digest is idempotent by title** (`Digest YYYY-MM-DD`): a second run on the same day replaces the same note, protected by its snapshot.
7. **No approval timeout.** Run events and snapshots older than `retentionDays` are pruned daily; runs, notes and pending approvals are never pruned; undo of a pruned run answers `410 undo-expired`.
8. **Stale approvals are not applied silently** (ADR-0011): `409 approval-stale`, then "Apply anyway" or "Reject".
9. **Live updates** use one NDJSON event stream (`GET /api/events`) with automatic polling fallback.
10. **Notes are flat in v1** (no subfolders), per ADR-0001's flat layout; subfolders are the first post-v1 item.
11. **No telemetry or analytics of any kind.**

## Consequences
- Predictable, documented behavior; each default has a test in its work package.
- The permissions page adds a `settings` table and one function (`effectiveGrants`) that every run path must use.
- Changing a default later needs an amendment to this ADR.
