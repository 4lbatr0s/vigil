# ADR-0016: UI v2 refinements (amends ADR-0005)

## Status
Accepted (2026-11-17)

## Context
Vigil v1.0.0 works, but the owner judged the interface not good enough next to the best note apps (Bear, Craft, Apple Notes, Linear). The "Quiet Instrument" rules in ADR-0005 were written for an agent dashboard: hairlines only, no shadows, no cards, 15px chrome text, a 56px icon-only rail, a bare list. They make a note app feel unfinished: nothing separates a menu from the page, rows cannot show a preview, and the rail has no labels. The owner chose: Bear/Craft writing polish with Linear-style speed, keep the identity, agents reviewable inside the writing surface.

## Decision
Keep from ADR-0005: the three voices (Newsreader prose, IBM Plex Mono machine text, Schibsted Grotesk chrome), the near-monochrome palette, amber reserved exclusively for agent life, dark default with a first-class light theme, motion 80 to 140 ms with reduced-motion support, the lantern flicker.

Relax:
- **Elevation.** One soft shadow token (`--shadow-pop`) is allowed on floating layers only: menus, popovers, the command palette, the selection toolbar, the slide-over list and the mobile drawer. Page structure still comes from hairlines.
- **Raised surfaces.** A `--surface-hover` and a `--surface-raised` token (mixed from existing tokens, never a new hue) are allowed for hover, selected and card-like panels (review panels, the Today view). Decorative cards stay banned.
- **Navigation.** At 1200 px and wider the rail shows icon and label (200 px). Below that it is the 56 px icon rail; below 640 px it is a drawer.
- **List rows** may be taller and carry a snippet and tags (fixed height, so virtualisation keeps working).

Unchanged and enforced by tests: colors only from `app.css`, contrast at least 4.5:1, visible focus, keyboard reachable, performance budgets.

## Consequences
- `docs/design/ui.md` and `docs/design/ux-spec.md` are updated in the same commits as the code.
- New tokens go in `app.css` only; `no-raw-colors.test.ts` and `contrast.test.ts` stay green.
- ADR-0005 stays Accepted; this ADR overrides it where they conflict.
