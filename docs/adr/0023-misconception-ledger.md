# ADR-0023: A list of what you got wrong, kept by you

## Status
Accepted (2026-11-17).

## Context
A recall check already shows what was missed and what disagrees with the note, but that feedback is forgotten once the page closes. Wrong beliefs are worth targeting: seeing them again before the next attempt, and making cards about them, uses the feedback the learner already earned.

## Decision
- State migration 13 adds `misconceptions` (id, note, text, created, resolved). Open items are those without `resolved_at`.
- After a recall check the page reads the "Check:" bullets of the checker's reply and lists them with checkboxes (kept by default), plus a box to add your own. Pressing a rating saves the kept ones (`POST /api/misconceptions`). Nothing is saved without the learner's rating press.
- The next recall check on that note lists the open items first, each with "I have this now" (`POST /api/misconceptions/:id/resolve`). Only the learner resolves an item; no agent does.
- The card maker's task gets the open items between SHAKY START and SHAKY END and is told to write cards for those the note covers. `learner_status` lists them for the weekly review.
- At most 5 items per request, 300 characters each, 20 open per note (the oldest are closed past that); a repeat of an open item is skipped.

## Consequences
- Quality depends on the checker. A 4B local model misread a recall live (it listed a mix-up as remembered and answered "None" under Check), so the learner can add items by hand and untick wrong ones.
- This is practice targeting, not a score or a proven effect; the copy makes no efficacy claim.
- Items are plain text about the learner's own mistakes, stored locally in `state.db`.
