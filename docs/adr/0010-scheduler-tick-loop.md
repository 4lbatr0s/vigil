# ADR-0010: Scheduler tick loop with a cron parser (amends v1 scope decision 13)

## Status
Accepted (2026-11-15). Amends `docs/spec/v1-scope.md` decision 13, which named `node-cron`.

## Context
Scheduled and heartbeat agents must run while the user is away. The server will sometimes be stopped (laptop sleep, deploy, crash). A plain `node-cron` timer fires only while the process is alive and cannot answer "did I miss a run?". Tests that wait for real clock time are slow and flaky.

## Decision
- Do not use `node-cron` for firing. Run one `setInterval` tick every 15 seconds (unref'd) in `apps/server/src/scheduler.ts`. Each tick asks a cron parser for the latest scheduled time at or before now and compares it with a persisted `last_scheduled_for` per agent.
- Parser: `cron-parser` 5.10.6 (pinned exactly; chosen over `croner` because `CronExpressionParser.parse(expr, { tz, currentDate })` with `prev()`/`next()` does exactly what the tick needs). `prev()` is strictly before `currentDate`, so the scheduler looks from `now + 1 ms` to include an exact hit. Only the five-field form is accepted (no seconds, no `@` aliases, no `H` random values) so a schedule means the same every day.
- Guarantees:
  1. At most once per scheduled time: persist `last_scheduled_for` before starting the run.
  2. First sight of an agent stores a baseline and does not run (saving an agent at 10:00 must not fire the 07:00 run).
  3. Catch-up: the tick that runs when the server starts treats a missed latest tick like a due tick, but only one run, never one per missed tick, and only if the miss is within `catchUpWindowHours` (default 24); older misses are skipped and noted.
  4. Never two runs of one agent: a due tick while the agent is running is recorded as skipped (`last_skip_reason`).
  5. A bad expression never throws out of a tick; it records a skip reason.
- Time zones: optional IANA zone per cron trigger, default `VIGIL_TZ`, then the system zone. Reject unknown zones when saving.
- The scheduler takes injected dependencies (`now`, `startRun`, `hasRunning`, agent list) so tests drive it with a fake clock and never sleep.
- Heartbeat checks (ADR-0004 archetype) reuse the same tick; see WP6 for change detection.

## Consequences
- Catch-up and tests are straightforward; one extra dependency (the parser).
- A daily agent can fire up to 15 seconds late; acceptable for notes.
- The tick loop adds a few cheap SQLite reads every 15 seconds; negligible at personal scale.
- Daylight-saving transitions are the parser's job; a test pins one-run-per-day across a transition. A local time that does not exist on the spring-forward day (for example 02:30 in New York) is skipped for that day by the parser; pick a time outside 02:00-03:00 for agents that must never miss a day.
