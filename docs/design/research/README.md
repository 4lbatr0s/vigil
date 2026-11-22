# UI research: Vigil against modern note apps

Status: first pass, 2026-11-22. Screenshots in `before/` (Vigil on a throwaway sample vault, 1440 and 390 px, dark and light) and `refs/` (public home pages of Bear, Craft, Obsidian, Reflect, Capacities, Linear, Notion, 1440 px). The reference shots show marketing pages and the product pictures on them, not the live apps, so treat them as direction, not measurements. Mobbin needs a login and was not used.

## What the Vigil screenshots show

Notes screen (`before/notes-1440-*.png`):
- A row of seven outlined buttons (Study, Make cards, Canvas, Map, Recall, Rename, Delete) sits above every note. Every action has the same weight, and Delete sits next to Rename. Nothing says which action matters.
- "Outline" and "Markdown" float as small text in the middle of the page, unrelated to the toolbar above.
- A permanent "Note title / New note / From text" form fills the bottom of the note list. Creating a note should be one icon or one shortcut, not a standing form.
- Three outlined controls (filter field, sort menu, calendar) plus tag chips sit above the list before the first note.
- A full-width banner about the missing AI model shows on every page. It is permanent chrome for a state that is not an error.
- The footer repeats the file name and word count in monospace, plus a "Linked from 0" row, so the bottom of the page is two more bars.
- The sidebar has four small uppercase group labels (WRITE, LEARN, AGENTS, APP) for nine items. The groups add reading work for few items.
- Almost everything is outlined: buttons, fields, chips, the search box, the list rows. Result: many thin boxes of equal weight.

Other pages: Today and Agents centre an illustration and a muted paragraph (`today-1440-dark.png`, `agents-1440-dark.png`), the same empty-state pattern twice. Agents shows two "Create an agent" buttons on one screen. On 390 px the list works, but the same bottom form takes a fifth of the screen.

## What the references do (from their own pages)

- **Bear:** content first. The product picture has a three-pane layout with a dark sidebar, a light list with a soft selected fill (no box) and a large bold note title. Chrome icons are small and grey. One accent colour (red) marks the selected row.
- **Craft:** documents shown as cards with colour only where it means something; very large, calm headline type; strong use of whitespace. The app picture uses a quiet sidebar with plain text rows and a small star/folder grouping.
- **Linear:** very low contrast between layers, tiny grey meta text, one light accent. Controls appear on hover. Hierarchy comes from text colour steps (white, grey, dim grey), not from borders.
- **Reflect:** dark, with the note itself in the middle and actions in a quiet right rail ("Pin this note", "Show history") instead of a button row.
- Common to all: a clear type scale with a large title, one primary action at a time, secondary actions behind a menu or an icon, no persistent "create" form, selection shown by fill not outline, and few borders.

## What to take for Vigil (feeds ADR-0029 and DESIGN.md)

1. One primary action per screen; the rest go into a "More" menu or the command palette. Delete is never next to Rename.
2. Selection is a soft fill. Outlines are for text fields only.
3. "New note" is an icon button in the list header plus a shortcut. Remove the standing form.
4. Move Outline / Markdown / word count into a quiet side rail or the "More" menu.
5. The no-model banner becomes a small inline notice inside the Agents and Chat screens only, and a dot on Settings elsewhere.
6. Drop the uppercase group labels or reduce the nav to one list with a divider before Settings.
7. Larger title type and a wider gap between title and body; keep serif for note content.
8. Text colour steps (ink, muted, faint) carry hierarchy instead of boxes.

## Not yet done

- Reference shots of the live apps themselves (needs the owner's accounts or screenshots; drop them in `refs/`).
- Impeccable `init`/`document` (see the status note in the chat: its launcher downloads a binary on first run and waits for approval).
