# ADR-0029: Design system v3, "Quiet paper", built from own tokens and Bits UI

## Status
Accepted (2026-11-22), after the owner reviewed the `/design` page and the migrated Notes screen. It supersedes the parts of ADR-0005, ADR-0016 and ADR-0018 listed below and section 0 and the controls table of `docs/design/ux-spec.md`. Every screen is migrated; `ui-lint.test.ts` now checks every `.svelte` file. Decision 4 (one system sans, the neutral palette) is superseded by ADR-0035 (2026-11-26).

## Context
The owner finds the UI amateur and machine-made, and far from current note apps. A screenshot review (`docs/design/research/README.md`) and a code audit found:

- Impeccable's mechanical detector reports nothing on `apps/web/src`, so the problem is not stock effects like gradients or glows. It is structure and craft.
- No shared primitives: `.btn` is redefined in 14 files, `.card` in 5, `.field` in 6, `.empty` in 7. Six dialogs copy the same backdrop and focus code. There is no Tabs, Toast or Tooltip.
- Every control is an outlined box of equal weight. The Notes screen has seven equal buttons above each note (Delete beside Rename) and a permanent "New note" form at the bottom of the list.
- Hierarchy is weak: a 13 / 15 / 17 px scale, uppercase group labels, a muted explainer paragraph under every heading.
- The three docs disagree about radius, shadow and cards (`ux-spec.md` says 4 px and no cards; ADR-0016 and the code use 8 and 12 px and cards).
- The palette (warm cream ground, serif display, amber accent) and two of the faces (Newsreader, IBM Plex) sit in the cluster that Impeccable lists as the common "AI default" look. Warmth is not the fault; being the default is. See Decision 4.

## Decision
1. **Direction: Quiet paper.** The page is the interface. One calm surface, space and type carry hierarchy, borders appear only where they separate a field or a floating layer, one primary action per screen, secondary actions in a menu or the command palette. Selection is a soft fill, never an outline. Reference: the structure of Bear and Craft (list row selected by fill, large title, small grey chrome), Linear's text-colour steps for hierarchy.
2. **Build on own tokens and Bits UI.** Behaviour (Dialog, Popover, Menu, Tabs, Tooltip, Select, Switch, Command) comes from `bits-ui` (headless, Svelte 5). All appearance is hand-written CSS from tokens. No Tailwind and no copied component kit, so the look is Vigil's own.
3. **One component home.** Shared components live in `apps/web/src/lib/ui/` with an index. A route never defines its own button, field, card, chip, empty state or dialog. A missing primitive is added to `ui/` and to the `/design` page first.
4. **Type: one system sans (chosen by the owner, 2026-11-22); palette: the neutral one.** Tokens expose roles (`--type-title`, `--type-body`, `--type-ui`, `--type-meta`, `--type-code`) and a base palette of three values (ground, ink, accent). The warm serif pairing and cream palette are not carried into the new tokens. The old Newsreader, Schibsted Grotesk and IBM Plex font packages stay installed only until the last legacy screen is migrated, then are removed. Amber stays reserved for agent activity.
5. **Tokens** in `apps/web/src/lib/styles/tokens.css`: a single base set with derived steps (the light theme is one override block), two line strengths, three elevation steps with a named use each, a 4 px space grid, radius scale (control, surface, float, pill), motion tokens (`--dur-fast`, `--dur-base`, `--dur-slow`, two easings), a density switch (comfortable, compact). `app.css` keeps only resets and base elements.
6. **Layout primitives** `Page`, `Stack`, `Cluster`, `Split`, `Section` replace the per-route `.page` wrappers and max-widths.
7. **Guardrails are tests and skills, not only prose.** A lint test (extends `no-raw-colors.test.ts`) fails on raw colours, px radii, font sizes or durations outside `tokens.css`, on `text-transform: uppercase`, and on duplicated primitive class names outside `ui/`. Component tests cover keyboard use and accessible names. Playwright screenshots of `/design` and the Notes screen are the visual baseline. Rules are in `docs/design/ui-rules.md`; project skills `vigil-ui-build`, `vigil-ui-review` and `vigil-copy` live in `.claude/skills/`.
8. **Agent presence is quiet.** Notes looks like a plain writing app. Agent life shows as small amber marks, a Today feed and the Approvals count. The "no model connected" banner is removed from global chrome and shown inside Agents and Chat only. (Confirmed by the owner, 2026-11-22.)
9. **Primary user is a learner who writes notes** (PRODUCT.md). Copy is short and plain; no paragraph under a heading unless it answers a question the learner has.

## Supersedes (once Accepted)
- ADR-0005: palette values, 4 px radius, "no shadows". Its serif / grotesk / mono role split stays unless the owner chooses otherwise in Decision 4.
- ADR-0016: "decorative cards stay banned" and the single `--shadow-pop`, replaced by the elevation steps in Decision 5.
- ADR-0018: the 8 px and 12 px radii and the `--surface-hover` / `--surface-raised` mixes, replaced by the radius scale and elevation steps.
- `docs/design/ux-spec.md` section 0 and the controls table, and the "banned decorative" lines in `docs/design/ui.md`.
- Unchanged: Lucide icons, no emoji, contrast of at least 4.5:1, visible focus, reduced motion, first-load budget of 180 KB gzip.

## Consequences
- The legacy tokens in `app.css` (`--bg`, `--surface`, `--hairline`, `--ink`, `--space-*`) are still defined because the Graph renderer, the canvas colours and some editor internals read them; new code uses `tokens.css` only. `contrast.test.ts` still guards the legacy hex values.
- `bits-ui` adds weight to the first-load bundle; `pnpm check:bundle` must stay under 180 KB gzip.
- Old per-route classes are deleted as screens migrate, not kept alongside.
- The rules are only as good as the review: `vigil-ui-review` (screenshots at 390, 1024 and 1440 px, dark and light, plus Impeccable `audit` and `critique`) runs after every UI change.
