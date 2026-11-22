---
name: vigil-ui-build
description: Use before writing or changing any Vigil UI (Svelte components, routes, styles, copy in apps/web). Loads the design system rules and makes you compose from src/lib/ui instead of writing new markup and CSS.
---

# Building UI in Vigil

Vigil's UI is built from one component library and one token file. Your job is to compose, not to invent. A screen that looks hand-made comes from reusing the same few parts with discipline.

## Before you write anything

1. Read `docs/design/ui-rules.md` (short). Read `PRODUCT.md` for who this is for: a learner who writes notes.
2. Read `apps/web/src/lib/styles/tokens.css` and `apps/web/src/lib/ui/index.ts`. List what already exists.
3. If the work is a whole new screen or a visual change, also load the `impeccable` skill (its `shape` command plans the screen). Do not ask it for a new visual world: the world is fixed by ADR-0029.

## While you write

- Compose the screen from `$lib/ui` (`Page`, `Stack`, `Cluster`, `Row`, `Button`, `IconButton`, `Field`, `Input`, `Menu`, `Dialog`, `Tabs`, `Switch`, `Badge`, `Kbd`, `EmptyState`, `Tooltip`).
- Need something that is not there? Stop. Add it to `src/lib/ui/` with a usage comment, export it, add it to `src/routes/design/+page.svelte`, and only then use it.
- Style only with tokens. If a value you need has no token, add a role to `tokens.css` and say why; do not write the number in the component.
- One primary action per screen. Secondary actions go in a `Menu` or the command palette.
- Copy: sentence case, one short sentence, buttons name the action (`vigil-copy` has examples).

## When you finish

- Add the migrated files to `MIGRATED` in `apps/web/src/lib/ui-lint.test.ts`.
- Run `vigil-ui-review`.
- Do not leave the old CSS for that screen behind: delete what the new components replaced.
