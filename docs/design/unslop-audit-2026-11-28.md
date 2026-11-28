# Unslop audit, 2026-11-28

Method: the unslop skill (heydamir/unslop, CC BY 4.0) and ponytail rules, on a throwaway demo vault
(`seed-demo-vault.mts`). 21 routes were screenshot at 1440x900 and 390x844, light and dark (84 images).
Each screen was checked against unslop's `signs.md`, plus `impeccable detect --json src`.

## Verdict: light slop

Vigil is mostly designed. ADR-0029 and ADR-0035 already ban most of unslop's signs, and the lint tests
enforce that: no gradients, glows, emoji, uppercase labels or raw colors. So unslop runs in **polish
mode**. The direction comes from the existing brand (warm paper, serif titles, amber only for agent life),
and only what the audit found gets fixed. No new ADR is needed for this part.

Direction, unslop's five lines, kept from the brand:

- **Product:** a notes app where a learner writes and studies, and helpers work on the notes under supervision.
- **Character:** calm, bookish, accountable.
- **World:** a paper notebook on a desk, with a careful assistant's pencil marks in the margin.
- **Moments:** the note page itself, in serif on paper, and the study card front.
- **Signature:** the amber dot and line for agent activity, used only where a helper did something.

## Signs found and fixed (commit `fix(web): unslop polish pass 1`)

| Sign (signs.md) | Where | Fix |
|---|---|---|
| Greeting headline | Today title "Good morning" (`routes/+page.svelte`) | Title is "Today"; the date line stays under it |
| Raw status words | Today "succeeded. No notes changed."; run title "succeeded" | `runStatusText()` in `lib/format.ts` (tested): "Finished", "Waiting for you", "Stopped at its token limit" and so on |
| Too many type roles; title and heading families mixed | Section headings in serif on Today, Settings and InboxSort, but sans elsewhere; titles in sans on the helper page, run page and `/design` | Per ADR-0035 decision 3: titles serif, section headings sans, everywhere |
| Second title on one page; trailing period | Study empty state "Nothing to study right now." at title size, under the "Study" title | Heading size, no period |
| Empty state that reads as a loading bar | Run page "Log" with no events | "No steps recorded." |
| Number format | Run tokens "1200 of 20000" | "1,200 of 20,000" |

impeccable found 6 advisory items, all in editor internals (`Editor.svelte`, `livePreview.ts`: 2 to 4 px
radii on inline marks; `app.css` legacy 16 px). They are left alone: those are text-mark sizes, not chrome.

## Pass 2 (done, commit `0f8196b`)

- Helper list rows (`routes/agents/+page.svelte`): name, then "manual" and a timestamp. The row does not say
  what the helper does. Show the description, or the first line of its task when the description is empty.
- Helper page: the "May" chips repeat the "What it may do" checkboxes lower down. Keep one.
- The "No AI model is connected" banner showed on Settings (linking to itself) and not on Ask, which
  needs a model. (Correction: it was already limited to 4 pages, not every page.)
- Run page: "Trigger manual" shows the raw value. Use "You started it", "On schedule", "When a note changed".

## Structure: why it is hard to understand

The menu has 6 entries: Today, Notes, Study, Ask, Helpers, Settings. Behind them there are 15 more pages,
reachable only by small text buttons:

| Hidden page | Only way in | Problem |
|---|---|---|
| Recall check, Gap check, Outline a text | three bare text buttons on Study | No line says what each one does or when to use it |
| Import cards, Download for Anki | two bare text buttons on Study | Same |
| Chat | "Chat with a helper" button on Ask | Two ways to talk to the app (Ask and Chat) with no explanation of the difference |
| Approvals | a button on Helpers, plus links in text | Something waiting for you sits two clicks deep |
| Runs | rows on Today and on a helper page | Fine as a detail page |
| Graph, Boards (canvas) | the List / Graph / Boards switch on Notes | Fine |
| Capture | the phone share target | Fine; it is not a menu page |

## Proposal (approved by the owner 2026-11-28, built)

Commits: Study `868c600`, Ask and Chat `1b16efe`, approvals first `721cb3a`.
Checked: `pnpm typecheck && pnpm test` green (46 + 465 + 677), first load 113.4 KB gzip (budget 180),
keyboard Tab path on Study and Ask reaches the new rows and switch with a visible focus ring.
Not checked: the "Needs you" sections with real pending approvals (the demo vault has none).


1. **Study becomes one page with three labelled parts:** "Review your cards", "Check yourself" (Recall,
   Gap, Outline, each a row with one sentence on what it does) and "Move cards in or out" (Import, Anki).
   Routes stay. Only the Study page changes.
2. **Ask and Chat on one page** with a two-way switch: "Answer from my notes" (cited) and "Talk to a
   helper". Chat keeps its URL. The switch explains the difference in place.
3. **Approvals move up:** when something is waiting, Today shows it first ("Waiting for you"), and Helpers
   shows a section at the top instead of a button.
4. **No page is removed.** Every old URL keeps working.

A new visual world (new colors or type) is **not** proposed. The audit found no reason for one, and it
would need an ADR that replaces ADR-0035.
