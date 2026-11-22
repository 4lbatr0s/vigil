# ADR-0031: Keep LangGraph behind AgentRunner; no coding-agent harness inside the app

## Status
Accepted (2026-11-22). Amends ADR-0009.

## Context
The owner asked whether Vigil should use an agent harness instead of LangGraph, and whether the AI is done correctly. A code audit and web research (summarised here) found:
- The runtime is about 1,150 lines. LangGraph is used thinly: a hand-built graph with `agent`, `tools` and (strict agents) `approve` nodes, one `interrupt()` for approvals, a SQLite checkpointer for strict runs and chat history. Streaming, the token budget, cancel, history trimming and summaries are Vigil's own code. The `AgentRunner` interface already allows a replacement.
- Most AI features are single-prompt workflows (Ask, Gap check, Card maker, Recall checker, Outline, tutors), not agents. That matches Anthropic's advice to prefer simple workflows and add agent loops only where needed.
- A coding-agent harness such as the Claude Agent SDK is built for file and shell work and is Claude-first. Vigil's agents have notes tools only, no shell, and run on any model including a local 4B one. The two do not fit.
- The measured pain was not the framework: empty replies from a small context window, weak 4B tool use, no retries, summaries lost on restart, and no way to compare models.

## Decision
- **Keep LangGraph** (pinned) behind `AgentRunner`. Do not swap it now.
- **No coding-agent harness inside the app.** Heavy, long-running agent work happens outside it: Claude Code or Codex can use the Vigil MCP server (ADR-0022) and the generated `AGENTS.md` vault rules, with Vigil's snapshots and undo.
- **Harden the runtime** (done with this ADR):
  - model calls retry on 429, 5xx and dropped connections (three tries, short backoff, `Retry-After`, never on 4xx, 501 or a server that is not running; a stream is retried only while opening; each retry is a run-log line);
  - Anthropic calls send `cache_control` (a call option in `@langchain/anthropic` 1.6.1) so the stable start of each request is read from the provider's cache;
  - chat summaries are stored in `state.db` (migration 15);
  - a tool agent that answers nothing and uses no tool now fails with a plain message;
  - the app asks Ollama what a model can do (`GET /api/llm/capabilities`: tools, pictures, window size) and warns on the agent page, in Chat and next to the pictures setting when a needed capability is known to be missing;
  - citation checks (`splitAnswer`, `verdict`) moved to `@vigil/shared` so the server's evals and the web page judge an answer identically;
  - an eval harness (`pnpm --filter @vigil/server eval`, fixtures in `apps/server/src/evals`) puts fixed questions to Ask your notes against any model from `VIGIL_LLM_*`, in a temp folder, and reports pass rate, empty replies, bad marks, failed runs and speed.
- **Revisit triggers:** a LangGraph upgrade breaks us; the pinned LangChain packages become a maintenance cost; or an eval shows the loop, not the model or the context, is the bottleneck. The smallest replacement is the Vercel AI SDK `ToolLoopAgent` with `needsApproval` plus our own SQLite message store (not verified against our Ollama setup).

## Consequences
- The LangChain dependency tree stays. Version pinning and the `AgentRunner` seam contain the risk.
- Model comparisons are now a command, not a feeling. The owner has still not run a model larger than the local 4B (todo-owner).
- Capability detection works only for Ollama; other providers show no warning rather than a wrong one.
- Next steps (plan in the session notes): one context builder for all AI calls, one suggestion surface, AI inside capture and writing, one retrieval entry point, a proposal-only lint agent.
