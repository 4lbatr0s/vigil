# ADR-0011: Strict mode, the approvals queue, and the checkpointer

## Status
Accepted (2026-11-15). Implements ADR-0004's "strict mode queues writes for approval" using the runtime chosen in ADR-0009. Amended 2026-11-26 by [ADR-0034](0034-recover-runs-after-restart.md): runs started by a person, a schedule or a note change use the checkpointer too, and a finished run's checkpoint is deleted.

## Context
ADR-0004 promises an optional per-agent strict mode: writes wait for the owner. LangGraph's `interrupt()` pauses a graph and resumes it with `Command({ resume })`, but a resumed node restarts from its beginning, so any side effect before the interrupt would happen twice. Pending approvals must survive a server restart.

## Decision
- **Checkpointer:** `@langchain/langgraph-checkpoint-sqlite`, pinned exactly to `1.1.0` (peer: `@langchain/core` ^1.1.44, installed 1.4.1; works with `@langchain/langgraph` 1.7.4; verified with a spike that interrupts, restarts with a fresh saver and resumes), writing to `data/checkpoints.db` (separate from `state.db`). Thread id = run id (chat threads: chat id). Only runs that can pause (strict agents with `write_notes`) compile with the checkpointer; other runs keep the plain graph.
- **A dedicated `approve` node before the `tools` node.** It performs no side effects. It collects the model's `write_note` calls, stores one approval row per call, and calls `interrupt()` once with all of them. On resume its return value (the decisions) goes into graph state; the `tools` node then executes approved calls and answers rejected calls with `error: the owner rejected this write`. Reads never need approval. Because the interrupted node holds no side effects, a re-run on resume is harmless.
- **Run status flow:** `running` -> `waiting-approval` -> `running` -> final. `markInterruptedRuns` must not touch `waiting-approval` rows. On server start, runs whose approvals are all decided (crash between decision and resume) are resumed.
- **Token accounting on resume** starts from the stored `tokens_used`, not zero.
- **Approvals table** (`state.db`, migration 5): id, run id, tool call id, tool, args (JSON; note text only, never a key), status (`pending`, `approved`, `rejected`), timestamps.
- **No timeout in v1.** A pending approval waits until decided. Revisit with notifications post-v1.
- **Delegation:** `call_agent` is refused when the parent or the child is strict and the child can write (a paused child inside a parent's tool node cannot wait for a human). The same holds for a child that would ask before any tool through `approveTools` (`fetch_url`, for example): the call is refused before a child run exists (2026-11-26; before that the child ran and ended `failed` at its first guarded call).
- **Defaults and owner control:** nothing is forced by the API. New agents (and template-created agents) take `strict` from the instance setting `newAgentsStrict` (default on); the owner can turn approvals off per agent. When an agent can both read notes and fetch the web and approvals are off, the UI warns (ADR-0006, ADR-0015).

- **Waiting runs own their agent.** `hasRunning` counts `waiting-approval`, so a second run (a heartbeat, a cron tick, Run now) cannot start while a write waits: two runs could propose writes to the same notes.
- **A resumed run is always strict.** Turning approvals off while a run waits does not turn a rejected write into an executed one; the tools node runs a write only with an explicit `approve` for that exact tool call id (fail closed).

## Consequences
- Approvals add a second SQLite file and one more migration.
- Strict agents are slower by design; the UI makes the queue visible (rail badge).
- **Stale writes are not applied silently.** Each approval stores `base_updated_at` (the note's `updatedAt` when proposed). Approving when the note has since changed answers `409 approval-stale`; the UI shows the diff against the current text and offers "Apply anyway" (`force: true`, snapshot taken first) or "Reject".
