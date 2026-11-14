# ADR-0009: LangGraph JS as the agent runtime

## Status
Accepted (2026-11-14)

## Context
ADR-0004 fixes what an agent is and may do. M1 needs a loop that calls a model, runs tools and stops on a budget. The owner chose LangGraph JS because strict mode (M3) is an interrupt-and-resume problem it already solves.

## Decision
- Use `@langchain/langgraph` with `@langchain/core`, `@langchain/openai` (any OpenAI-compatible base URL, chat completions) and `@langchain/ollama` (native Ollama). Versions are pinned exactly: 1.7.4, 1.4.1, 1.8.4, 1.3.0.
- The graph is thin: an `agent` node (model call) and a `tools` node. We write the tools node ourselves instead of the prebuilt `ToolNode`, because the allowlist check, output truncation, snapshots and run-log events belong there. Every tool call gets a tool message back, even when denied or failed.
- Everything that makes agents safe stays in Vigil code, not in the graph: the tool allowlist, the token budget, snapshots, the run log, note-id validation.
- The runner sits behind a small `AgentRunner` interface so LangGraph can be replaced.
- **Budget fails closed.** Usage is the sum of `usage_metadata`; when a provider omits it, estimate characters / 4. The remaining budget is passed as `maxTokens`. A step limit stops loops (`step-limit`).
- **No checkpointer in M1.** Nothing pauses before strict mode. M3 adds `@langchain/langgraph-checkpoint-sqlite` writing to `data/state.db`; because a resumed node re-runs from its start, write tools must be idempotent.
- Run state (agents, runs, events, snapshots) lives in `data/state.db`, never in the disposable index (ADR-0008). Migrations there are additive.
- Provider settings come from env: `VIGIL_LLM_PROVIDER` (`openai` or `ollama`), `VIGIL_LLM_BASE_URL`, `VIGIL_LLM_API_KEY`, `VIGIL_LLM_MODEL`. Keys are never stored in notes, never logged, never put in run events.

## Consequences
- A larger dependency tree than a hand-written loop. Pinning and the `AgentRunner` interface contain the churn risk.
- Note text is untrusted input; the system prompt frames it as data, and tool output is capped (about 8k characters).
