# ADR-0020: Note recall checks and the study outline

## Status
Accepted (2026-11-17). Recall checks built; the outline helper follows.

## Context
Cards test single facts. A learner also needs to bring a whole note back to mind. Free recall is retrieval practice, and judgments of learning made right after studying are inflated by familiarity and are more accurate after a delay (Koriat and Bjork 2006). Generating content works best when the task makes the learner do work the text did not already do (Schindler and Richter 2023). Agents that do the thinking for the learner lower engagement (Bastani 2025).

## Decision
- **Recall checks are note-level and use a fixed ladder of days (1, 3, 7, 21)**, stored in `state.db` (migration 12, `note_recall`). Cards keep FSRS; this is deliberately small. The learner rates each check themselves (most, some, little): most moves up a rung, some repeats, little goes back one. After the last rung a good result waits twice as long again.
- **The Recall checker agent has no tools.** The note and the learner's own words travel in its task between markers and are treated as data. It lists what was remembered, what was missed (with the line from the note quoted) and what disagrees. It never rewrites the learner's text. The learner always has the final say and the note is one click away.
- The check starts from a button the learner presses; the agent is created and switched on at that press if it is missing, like the card maker.
- Recall text is capped at 6,000 characters and the note at 20,000.
- **Study outline** (separate slice): an agent proposes headings with a guiding question under each and leaves the answers empty for the learner to write.

## Consequences
- One table, one small module (`recall.ts`), one page (`/recall`), one agent template.
- A 4B local model grades loosely (checked once: it quoted real lines and caught a wrong claim, but its section labels were sloppy), so no score is shown, only the learner's own rating.
