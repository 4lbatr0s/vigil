# ADR-0034: Continue a run after a server restart

## Status
Accepted (2026-11-26). Amends ADR-0009 (LangGraph runtime) and ADR-0011 (strict mode and the checkpointer): a checkpointer is no longer used only by strict runs and chat.

## Context
When the server stops in the middle of a run (a crash, a deploy, a reboot), `markInterruptedRuns` marks every `running` run `interrupted` at the next start. The work the run did so far is lost and the owner has to start it again. Anthropic's advice for long-running agents is to continue from a saved point instead of starting again.

LangGraph can continue a graph from its last checkpoint, but it re-runs the node that was in progress. The `tools` node runs every tool call of one step as one unit. A crash inside it would run all those calls again, including a write that already happened, so `append_note` could add the same text twice. That breaks the rule that scheduled work happens at most once (AGENTS.md).

## Decision
- Runs started by a person, a schedule or a note change (`trigger` `manual`, `cron` or `heartbeat`, with no parent run) save a checkpoint after each graph step, under the run id.
- At start, before the rest are marked `interrupted`, the server continues each such run that was left `running`, **once**. The run keeps its id, its token count and its snapshots, so undo covers the work from before and after the restart.
- **No tool runs again by itself.** The server reads the messages of the last checkpoint, deletes that checkpoint, and gives every tool call that has no answer this answer: "error: the server restarted while this call was running; it may or may not have happened. Read the note before writing again." Then it starts the graph fresh with those messages. The model decides what to do next.
- These runs are marked `interrupted` instead, as before:
  - child runs (`call_agent`): a child continued from its stored setup would lose its caller's write scope; the parent's open `call_agent` call gets the restart answer.
  - chat and MCP runs: the caller's connection is gone.
  - runs that have approval rows: a crash while those rows were being written can leave them half done.
  - runs whose agent was deleted or switched off.
  - runs without a checkpoint (the server stopped before the first step was saved).
  - runs already continued once: the run log line "continued after a server restart" is the marker, so a tool that crashes the server every time cannot make it crash again at every start.
- A run's checkpoint is deleted when the run ends (any status except `waiting-approval`). This also removes the checkpoints that finished strict runs used to leave behind.

## Consequences
- A run interrupted by a restart usually finishes on its own. Its log shows where it continued.
- Every step of a recoverable run writes a checkpoint to `data/checkpoints.db`. The checkpoint holds the run's whole message list, so the write grows with the run (strict runs already paid this). A run has at most about 25 steps and its tool results are capped, and the rows are deleted when the run ends.
- A write that finished just before the crash is not known for sure. The model is told it may have happened and to check. It may still write again; undo then restores both writes together.
- The restart answer is a synthetic tool message, like the ones `repairDangling` makes. Whether DeepSeek accepts it is unchecked (todo item 26).
- `scripts/kill-recover.mjs` checks the whole path against the bundled server with a real SIGKILL (not part of the gate).
