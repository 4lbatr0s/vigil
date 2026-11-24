# ADR-0032: Optional hard monthly token cap

## Status
Accepted (2026-11-24). Amends ADR-0003 (the soft monthly cap).

## Context
ADR-0003 made the monthly cap soft: it only shows a banner. A hosted model with many cron or heartbeat agents can still spend without limit. A per-run budget exists, but nothing limits the sum.

## Decision
- Add `VIGIL_MONTHLY_TOKEN_HARD_CAP`. When it is set to a positive number and this month's tokens have reached it, Vigil refuses to start a new run or chat turn. The API answers 429 with code `monthly-cap-reached`. A scheduled run records `start failed: ...` as its skip reason.
- Unset, empty or not a positive number means no hard cap. The default behaviour does not change, and `VIGIL_MONTHLY_TOKEN_CAP` stays a soft warning.
- A run that already started is never stopped by the cap. Resuming a run after the owner decided its writes is allowed, because the owner is acting and the run's own budget still applies.

## Consequences
- The owner can set both caps: warn at the soft cap, stop at the hard cap.
- Usage counts tokens of runs started this UTC month, so the block lifts on the first of the next month.
