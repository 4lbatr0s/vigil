# ADR-0002: Agentic-centered product; single-user; self-host first, cloud-ready

## Status
Accepted (2026-11-14)

## Context
The niche is "useful AI agents living in your notes." Notes-first positioning makes Vigil "Memos with a nicer editor" — no switch reason. The persona (self-hosting AI tinkerer) only gains from a server because agents run while the laptop is closed.

## Decision
- The agent runtime is the differentiating pillar; the home surface shows agent activity. Notes are the shared memory and UI for humans and agents.
- Strictly single-user in v1 (one login; no teams).
- v1 ships self-hosted (one Docker image). The architecture stays cloud-ready: env-based config, vault root abstraction, keys stored server-side — so a hosted phase-2 reuses the same code.

## Consequences
- Agent runtime (scheduler, tools, run logs, budgets) is core infrastructure, not a plugin.
- The editor quality bar stays non-negotiable: users open Vigil to write 10x more often than to configure agents.
- Every feature must work identically self-hosted and (later) cloud.
