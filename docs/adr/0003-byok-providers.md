# ADR-0003: BYOK — OpenAI-compatible endpoints + native Ollama; no bundled AI

## Status
Accepted (2026-11-14)

## Context
Vigil is self-deployable and niche; we cannot carry an inference bill, and the persona expects local models.

## Decision
Users bring their own model access: any OpenAI-compatible base URL + API key (OpenAI, Anthropic-compatible routers, OpenRouter, LM Studio), plus native Ollama for fully-local setups. Keys are stored server-side in the instance's config/env, never in the repo, never in notes.

## Consequences
- One provider adapter interface; "OpenAI-compatible" covers most of the market.
- Cost is the user's own bill; Vigil adds per-run token budgets and a soft monthly cap with warning.
- No AI features work without configured keys — onboarding must make this a first-class setup step.
