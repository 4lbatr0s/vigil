# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

A learner who writes notes: a student or self-learner who captures, writes, studies and remembers. They run Vigil themselves (self-hosted, single user) and are comfortable pointing it at a model, but they open it to write and learn, not to configure agents. (Confirmed by the owner 2026-11-22. The v1 scope named a "self-hosting AI tinkerer"; that is the setup audience, not the daily user.)

## Product Purpose

Vigil is a notes app where plain markdown files are the source of truth and AI agents help the learner think: they file the inbox, make study cards, run recall checks, keep a wiki, write digests. Success is a learner who writes more, remembers more and never loses a note to an agent.

## Positioning

Notes you own as files on disk, with agents that are supervised by design: every agent write is snapshotted, undoable and optionally approved first. A hosted note app cannot truthfully offer both file ownership and this write safety.

## Operating Context

Single-user web app served from the learner's own computer or server, installable as a PWA, used on desktop and phone. Notes are markdown with wikilinks, tags, tables and callouts. Study uses spaced repetition (FSRS), exam dates and recall checks. Models are bring-your-own (any OpenAI-compatible endpoint or Ollama).

## Capabilities and Constraints

- Notes: block editor (default) or plain markdown, note list, tags, calendar of daily notes, graph, canvas boards.
- Study: cards written as `Question :: Answer` or `{{hidden}}`, review, recall checks, exam dates, misconception ledger.
- Agents: chat, scheduled and on-change agents, approvals queue, run log with undo, ready-made templates, Agent Skills import and export.
- Ask your notes with line-level citations; search by meaning (optional embedding model).
- Constraints: no telemetry; no emoji in the UI; Lucide icons; keyboard reachable with visible focus; contrast at least 4.5:1; reduced motion honoured; first load under 180 KB gzip.
- Undecided: the product name "Vigil" is not yet cleared (name check on the owner list).

## Brand Commitments

- Amber means agent life only (activity, authorship, pending approval). It is never decoration.
- Warm, kind second-person voice; short plain sentences. No exclamation marks, no hype.
- Warm paper, and a serif for the learner's own words and titles; the system sans for interface chrome; monospace for machine text (ADR-0035).

## Evidence on Hand

- No customer testimonials, benchmarks or usage numbers exist. Do not invent any.
- Screenshots of the current UI: `docs/design/research/before/`.
- Reference-app research: `docs/design/research/README.md`.

## Product Principles

1. The learner's notes are theirs: files first, agent writes are always reversible.
2. Writing comes first. Agents stay quiet until they have something worth a decision.
3. Every agent action is visible and attributable; nothing happens silently.
4. Plain words over jargon: the interface explains by being clear, not by adding paragraphs.
5. Fast and light: performance and usability balance beats feature count.

## Accessibility & Inclusion

Contrast at least 4.5:1 for text, full keyboard operation, visible focus, reduced-motion support, touch targets of 40 px on coarse pointers, readable on a 390 px phone.
