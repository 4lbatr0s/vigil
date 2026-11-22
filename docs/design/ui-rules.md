# UI rules (design system v3)

Short, imperative, checkable. Source of truth for how UI is written in `apps/web`. Reasons are in [ADR-0029](../adr/0029-design-system-v3.md); the product and its users are in [`PRODUCT.md`](../../PRODUCT.md). Read these first, then `apps/web/src/lib/styles/tokens.css`, then the `/design` page (`pnpm --filter @vigil/web dev`, open `/design`).

Until the owner accepts ADR-0029 these rules apply to `src/lib/ui/`, `/design` and every file listed in `MIGRATED` in `apps/web/src/lib/ui-lint.test.ts`. Legacy screens keep their old CSS until migrated, one screen per commit.

## Build

1. Compose from `$lib/ui`. Never write a button, field, row, card, chip, dialog, menu, tab, tooltip or empty state in a route. If a piece is missing, add it to `src/lib/ui/`, export it from `index.ts` and show it on `/design` first.
2. Use tokens only. Colour, size, radius, shadow, duration and font come from `tokens.css`. No hex, `rgb()`, `oklch()`, px radius, px font size or ms literal outside it.
3. Layout with `Page`, `Stack`, `Cluster`. A route sets no `max-width` of its own.
4. Behaviour comes from Bits UI inside `ui/` (focus trap, arrow keys, Escape, ARIA). Do not hand-roll a menu, dialog, tooltip, tabs or select.
5. Icons: Lucide only, one icon per import path, 16 px in controls. No emoji.

## Look

6. One primary action per screen (`Button variant="primary"`). Everything else is `quiet` or `ghost`, or sits in a `Menu` or the command palette. Delete is never next to Rename.
7. Hierarchy comes from type size, weight and the three text steps (`--text`, `--text-2`, `--text-3`), not from boxes. Do not wrap content in a bordered card to group it; use space.
8. Selection and hover are soft fills (`--fill-*`). Outlines are for text fields and the focus ring only.
9. Elevation: flat by default. `--elev-float` for menus and popovers, `--elev-overlay` for dialogs. Nothing else casts a shadow.
10. Amber (`--agent`) marks agent activity only: authorship, a running run, a pending approval. Never decoration.
11. Banned: uppercase labels, gradients, glows, blur, left or right accent stripes, bounce or spring easing, centred hero text in the app, illustrations in empty states.
12. Motion is 90, 150 or 240 ms with the two easings. State changes only; nothing moves on its own. `prefers-reduced-motion` is handled in `tokens.css`; do not add another query.

## Copy

13. Sentence case. Buttons name the action: "Delete note", not "OK" or "Submit".
14. One short sentence. No paragraph under a heading unless it answers a question the learner has. No "Let's", no exclamation marks, no emoji.
15. Errors say what happened and what to do next, in the user's words, next to the field (`Field error`).
16. Empty states say what is missing and offer the single next step (`EmptyState`).

## Accessible by default

17. Every control has a visible label or an `aria-label` (`IconButton` requires `label`). Focus is visible on every control (the ring is `--focus`).
18. Text contrast at least 4.5:1 in both themes; touch targets 40 px on coarse pointers (`--control-h` already does this).
19. Everything works by keyboard, and at 390 px width without horizontal scroll.

## Check before you finish

- `pnpm typecheck && pnpm test` (includes `ui-lint.test.ts`).
- Screenshot the screen at 390, 1024 and 1440 px in light and dark. Look at them.
- `impeccable detect --json --changed` from `apps/web`, then `/impeccable critique` for anything new.
- Add the files you migrated to `MIGRATED` in `ui-lint.test.ts`.
