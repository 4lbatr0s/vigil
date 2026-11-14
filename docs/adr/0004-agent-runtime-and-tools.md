# ADR-0004: One agent runtime; three archetypes; bounded tools and a2a

## Status
Accepted (2026-11-14)

## Context
Agents are the product. Unbounded agent autonomy (shell, arbitrary network, unbounded nesting) is a security and cost hazard; unbounded breadth (multi-agent swarms) is a v1 rabbit hole.

## Decision
- One runtime, three archetypes: chat (interactive), scheduled (cron expression), heartbeat (light interval runs that act on change).
- Agent = { name, system prompt, tool allowlist, trigger, token budget }.
- Tools in v1: read notes, write notes (snapshot-first), web fetch (GET only). No shell, no arbitrary network.
- Agent-to-agent talk: any agent may call call_agent(name, message) — nested run, depth 1, everything in the run log.
- Every agent action lands in a run log; every write snapshots the target file first (one-click undo). Strict mode (per agent) queues writes for approval.

## Consequences
- Prompt injection is contained: a poisoned web page can at worst cause note writes that are snapshotted and logged — never shell, never exfiltration endpoints.
- Multi-agent networks beyond depth 1 are explicitly out of v1 scope.
