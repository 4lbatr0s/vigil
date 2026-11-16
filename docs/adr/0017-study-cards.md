# ADR-0017: Study cards and spaced review

## Status
Accepted (2026-11-17). Started: card parser and scheduler wrapper done; storage, API and screens still to do.

## Context
The owner wants learners first. Research ranks practice testing and spaced practice highest (Dunlosky 2013; Adesope 2017; Cepeda 2006). It also warns that AI which does the thinking for the learner can lower engagement and transfer (Bastani 2025; Fan 2025). No integrated tool covers notes, AI-proposed cards, human review and spaced review.

## Decision
- **Cards live in the notes as markdown.** Two inline forms, conventionally under a `## Cards` heading: `Question :: Answer` on one line, and `{{hidden text}}` cloze inside a sentence. Code blocks are ignored. Card id is a hash of the normalised front text; editing the text makes a new card.
- **Scheduling state is durable and lives in `state.db`** (migration 8: `card_state`, `reviews`, and `runs.result` for the full final answer of a run). The card list is part of the disposable index (schema 5).
- **Scheduler: FSRS via the `ts-fsrs` package**, pinned to an exact version and wrapped in `srs.ts` with an injected clock. The installed typings are checked before coding. If the package disappoints, a small SM-2 implementation replaces it.
- **The Card maker agent has no write tool.** Its answer is parsed into proposed cards; the owner accepts, edits or rejects each, and the accepted cards are appended by the owner's own save. Nothing unreviewed enters the deck.
- **Agents do the chores, the learner does the thinking:** tutor-style agents ask first, hint second and answer last, and say when an answer is not from the notes.
- No product copy claims "10x" gains. Claims are limited to what the cited research supports.

## Consequences
- A new dependency (`ts-fsrs`) and an append-only migration.
- Benefit figures for FSRS over SM-2 came from secondary sources and are not quoted in the product until checked.
