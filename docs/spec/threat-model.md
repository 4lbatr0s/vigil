# Vigil threat model

Scope: a single-user, self-hosted instance (loopback by default, optionally exposed behind a reverse proxy). Updated when a work package adds a tool, a route or a trust boundary; each such task lists its row here.

## 1. What we protect (assets)

| Asset | Why it matters |
| --- | --- |
| The vault (notes) | the user's private writing; the only data that cannot be rebuilt |
| The model API key | costs money, grants access to the user's account |
| Agent definitions and run history | reveal prompts and behavior; losing them is an inconvenience |
| The machine and network Vigil runs on | an agent must not become a way in |

## 2. Actors and trust

| Actor | Trust |
| --- | --- |
| Owner (browser session or token) | trusted |
| The model | **not trusted to be correct or loyal**; it follows text it reads |
| Note text, imported files | **untrusted data** (may contain instructions) |
| Web pages fetched by an agent | **untrusted data** |
| Other websites the owner visits | hostile to the API |
| Other devices on the LAN | hostile to the API |
| Other processes on the machine | partly trusted (Obsidian may edit the vault) |

## 3. Trust boundaries

1. Browser <-> API (same origin; token or cookie; Host and Origin checked)
2. API <-> filesystem (only through `vault.ts`; ids validated; writes under a lock)
3. Agent runtime <-> tools (allowlist per agent; tools return text, never throw)
4. Agent runtime <-> model endpoint (outbound HTTPS to the configured URL only)
5. Agent tools <-> the web (`web_fetch` only, allowlisted hosts, SSRF-safe)

## 4. Threats and controls

| # | Threat | Control | Status | Test |
| --- | --- | --- | --- | --- |
| T1 | A website the owner visits calls `localhost:3001` and reads or writes notes | loopback bind, no CORS, Host check (anti DNS rebinding), Origin check | built | `access.test.ts` |
| T2 | A LAN device reaches the API | default bind 127.0.0.1; non-local bind refused without `VIGIL_TOKEN` | built | `access.test.ts` |
| T3 | Token guessing | constant-time compare; login rate limit (5 failures/min/IP, then 429) | token built; login planned (WP12) | `login.test.ts` |
| T4 | Prompt injection in a note makes an agent do something harmful | agent has only granted tools; no shell; writes snapshotted, logged, undoable; strict mode for risky agents; untrusted-data framing in the system prompt | built (strict planned) | `agents.test.ts` |
| T5 | Injected agent leaks note text through a URL | `web_fetch` needs a per-agent host allowlist; empty list refuses everything; instance-wide web switch; approvals on by default for new agents; the UI warns when read + fetch run without approvals; full URL logged | planned (WP10, WP8, WP3-T5) | `safe-fetch.test.ts`, `permissions.test.ts` |
| T6 | SSRF to localhost, LAN, cloud metadata | address block list incl. `169.254.169.254` and IPv4-mapped IPv6; resolve-validate-pin; per-hop redirect checks; ports 80/443 only | planned (WP10) | `safe-fetch.test.ts` |
| T7 | Key leaks into logs, events, errors or API responses | env only; `redact` on events and errors; `/api/llm/status` never returns the key | built (status planned) | `agents.test.ts`, status test |
| T8 | Agent or human overwrites the other's work | atomic writes; `baseUpdatedAt` conflict check; snapshot before every agent write; undo refuses when a human edited later; one lock for all note mutations | built | `vault.test.ts`, `agents.test.ts` |
| T9 | Path traversal via note id or static file path | `validateId` (`^[a-z0-9][a-z0-9-]*$`); static resolver requires the resolved path inside the directory; symlinks outside the vault refused (with subfolders, post-v1) | ids built; static planned | `vault.test.ts`, `static.test.ts` |
| T10 | XSS from note content rendered in the UI | `marked` then DOMPurify; strict CSP; SPA without SSR | sanitizer built; CSP planned | `render.test.ts`, headers test |
| T11 | Runaway cost or loops | per-run token budget that fails closed (usage estimated when missing; remaining budget passed as `maxTokens`); step limit; one run per agent; `call_agent` depth 1 and shared budget; soft monthly cap | built (cap, chain planned) | `agents.test.ts`, `usage.test.ts` |
| T12 | Agent chain amplification (A triggers B triggers A) | heartbeat ignores notes the same agent wrote; minimum interval 5 min; `call_agent` children cannot call agents | planned (WP6, WP7) | `heartbeat.test.ts` |
| T13 | Login CSRF / cookie theft | `HttpOnly`, `SameSite=Strict`, `Secure` over HTTPS; Origin check on every request | planned (WP12) | `login.test.ts` |
| T14 | Duplicate side effects (double run, double write) | persist-before-run for cron and heartbeat; approval node holds no side effects; run lock | built/planned | `scheduler.test.ts`, `agents.test.ts` |
| T15 | Container escape or root in the container | non-root `node` user; no extra capabilities documented; vault is a mounted volume | planned (WP12) | manual |
| T17 | A stale approval overwrites a newer human edit | approval stores the note's `updatedAt`; approving after a change answers `409 approval-stale`; apply-anyway needs `force`, snapshot first | planned (WP8) | `agents.test.ts` |
| T18 | Event stream leaks data or exhausts connections | events carry ids, statuses and counts only (run-event: run id, seq and kind, never text), never bodies, prompts or keys; 20-stream cap; same `checkAccess` | built (WP4-T9) | `events.test.ts` |
| T16 | Malicious dependency | exact pins for the LangChain family and agent-adjacent libraries; lockfile committed; `pnpm install --frozen-lockfile` in CI | partly built | CI |

## 5. Residual risks (accepted, stated plainly)

- **A granted-write agent can write bad text into your notes.** Snapshots and undo limit the damage; strict mode removes it for agents you do not trust yet.
- **Allowlisted hosts can still receive data in URLs.** The allowlist narrows the channel to hosts the owner chose; the run log shows every URL.
- **An editor outside Vigil can change a file between a check and a write.** The window is milliseconds; undo re-checks each note right before acting.
- **The model provider sees what the agent reads.** This is inherent to bring-your-own-key. Use Ollama for fully local operation.
- **A shared secret (`VIGIL_TOKEN`) is the only credential.** No per-user accounts exist in v1 (single user by design).
- **Obsidian-style plugins are out of scope.** Vigil does not execute vault content.

## 6. Review checklist for any new feature

1. Does it add a tool, a route, an outbound call, or a stored secret? If yes, add rows above.
2. What is the worst the model can do with it if it obeys a malicious note?
3. Is there a test that fails if the control is removed?
4. Does any new event, error or response risk containing a key? Add a redaction assertion.
