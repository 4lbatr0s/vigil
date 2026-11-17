# ADR-0019: Exam dates pace the reviews

## Status
Accepted (2026-11-17).

## Context
Spacing research shows that the best gap between study sessions depends on when the test is. Cepeda et al. (2008, Psychological Science 19(11)) tested more than 1,350 people: for any fixed test delay, gaps that were too short or too long both did worse, and the best gap was a smaller share of the delay the further away the test was (about 20 to 40% of a 1-week delay, 5 to 10% of a 1-year delay in the published version; a preprint gave a different figure for one year, so the exact numbers need the journal article before they are quoted in the product). FSRS alone aims at a retention target and does not know a date.

## Decision
- A **goal** is a date for one note or one tag (migration 11, table `goals`, append-only). Notes and tags only, no free-form scopes. The day is the viewer's calendar day.
- Two rules, both inside the existing FSRS scheduler (no second scheduler):
  1. **Retention rises as the day nears:** 0.85 when more than 60 days away, 0.90 up to 60, 0.92 up to 21, 0.95 in the last week. Outside any goal the default stays 0.90. These steps are a design choice shaped by the Cepeda result, not a tuned FSRS setting; they are shown to the learner and can be removed by deleting the date.
  2. **No review lands after the exam:** a card's next review is pulled in to the middle of the day before (never sooner than three hours from now). The same cap applies when the queue and the counts are built, so setting a date also pulls in cards that were already scheduled later. It never pushes a review out.
- When several dates cover a card, the nearest coming one wins. Dates in the past are ignored.
- "On pace" means the unseen cards, spread over the days left, fit the new-card pace. Copy says what to do next and never counts down guilt.

## Consequences
- One new table and one new module (`goals.ts`) with pure rules that are tested with an injected clock.
- Heavy use of a date raises the review load near the exam; that is the intended trade.
- Without a date nothing changes.
