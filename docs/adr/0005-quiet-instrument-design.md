# ADR-0005: Design system — "Quiet Instrument"

## Status
Accepted (2026-11-14)

## Context
Editorial-brutalism (the house default) was rejected: its cream+terracotta-serif palette is the #1 AI-generated-design tell of 2026, and its register is a document/dashboard aesthetic, wrong for a daily-driver prose app. Direction A "Quiet Instrument" was chosen over "Paper & Ink" and "Console".

## Decision
- Semantic typography: serif (Newsreader) = the human voice; monospace (IBM Plex Mono) = the machine voice (agent output, cron, timestamps, paths); UI sans (Schibsted Grotesk) for chrome.
- One accent: lantern amber #E8A33D (dark) / #B47612 (light), reserved exclusively for agent life (active runs, agent-written notes, graph glow). Never buttons, never decoration.
- Near-monochrome surfaces: dark default #111113/#1A1A1E/hairline #26262B; light theme #FAFAF8/#FFFFFF/#E7E7E3.
- Structure via hairlines and weight; no soft shadows; radius only on interactive surfaces (4px).
- Motion 80–140ms ease-out; the single orchestrated moment is the "lantern flicker" when a scheduled agent lands a note. prefers-reduced-motion respected.

## Consequences
- All UI pulls tokens from docs/design/ui.md; raw hex values outside the tokens file are a review failure.
- Full token table and component stances live in docs/design/ui.md (single source of truth).
