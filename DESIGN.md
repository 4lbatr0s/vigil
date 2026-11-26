---
name: Vigil
description: A warm, quiet paper-like notes app where the writing is the interface and agents stay in the margin.
colors:
  paper: "oklch(97.8% 0.013 84)"
  paper-dark: "oklch(20.5% 0.012 62)"
  text: "oklch(25% 0.018 58)"
  text-dark: "oklch(93% 0.013 82)"
  agent: "oklch(52% 0.12 70)"
  agent-dark: "oklch(78% 0.14 78)"
  danger: "oklch(50% 0.17 27)"
  focus: "oklch(55% 0.16 255)"
typography:
  title:
    fontFamily: "Iowan Old Style, Charter, Source Serif 4, Georgia, serif"
    fontSize: "34px"
    fontWeight: 600
    lineHeight: "40px"
    letterSpacing: "-0.01em"
  heading:
    fontFamily: "system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "21px"
    fontWeight: 600
    lineHeight: "28px"
  body:
    fontFamily: "Iowan Old Style, Charter, Source Serif 4, Georgia, serif"
    fontSize: "17px"
    fontWeight: 400
    lineHeight: "28px"
  ui:
    fontFamily: "system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "14px"
    fontWeight: 500
    lineHeight: "20px"
  meta:
    fontFamily: "system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: "16px"
rounded:
  control: "6px"
  surface: "10px"
  float: "14px"
  pill: "999px"
spacing:
  s1: "4px"
  s2: "8px"
  s3: "12px"
  s4: "16px"
  s6: "24px"
  s8: "32px"
components:
  button-primary:
    backgroundColor: "{colors.text}"
    textColor: "{colors.paper}"
    rounded: "{rounded.control}"
    height: "32px"
    padding: "0 12px"
  button-quiet:
    backgroundColor: "color-mix(text 5%, transparent)"
    textColor: "{colors.text}"
    rounded: "{rounded.control}"
    height: "32px"
    padding: "0 12px"
  row:
    rounded: "{rounded.control}"
    padding: "8px 12px"
---

# Design System: Vigil

The values above are a summary. `apps/web/src/lib/styles/tokens.css` is the source of truth, and the `/design` page (dev server, `/design`) shows every token and component.

## Overview

**Creative North Star: "The Margin"**

Vigil is a sheet of paper with a margin. The learner's writing is the whole interface; the agents work in the margin and only reach into the page when they have something to ask. Nothing is boxed to look important. Hierarchy comes from type size, weight and three steps of ink, and from space.

The mood is calm and warm, closer to a good paper notebook than a dashboard (ADR-0035). Light is warm paper, not saturated cream; dark is warm charcoal. The learner's words and titles are set in a serif, the interface in the system sans, and buttons are ink-coloured. The look stays plain so the learner's own words carry it.

**Key Characteristics:**
- One surface plus whitespace; borders appear only on text fields, the focus ring and the single line between the note list and the page.
- Selection and hover are soft ink-tinted fills, never outlines.
- One primary action per screen, in ink. Everything else is quiet or in a menu.
- Amber means an agent did or is waiting to do something. It is never decoration.
- Flat by default. Only menus, popovers and dialogs float.

## Colors

A restrained warm palette with one meaning-bearing accent.

### Primary
- **Ink** (`--text`): body text, the primary button fill, active states. Three steps: `--text`, `--text-2` (secondary), `--text-3` (hints, times).

### Secondary
- **Agent amber** (`--agent`): authorship marks ("written by morning-digest"), a pending approval badge, the landed-note wash.

### Neutral
- **Paper** (`--paper`, warm paper; warm charcoal in dark), **Sunk** (`--paper-sunk`, the sidebar), **Float** (`--paper-float`, menus and dialogs).
- **Fills** (`--fill-hover`, `--fill-selected`, `--fill-pressed`) and **Lines** (`--line-soft`, `--line`) are mixes of ink, so they work on every surface.
- **Danger** (`--danger`), **Good** (`--good`), **Focus** (`--focus`, the ring and text selection).

### Named Rules
**The Amber Rule.** Amber appears only where an agent acts. If a screen has amber and no agent, remove it.
**The One Voice Rule.** Light and dark are one declaration each (`light-dark()`); never write a second palette.

## Typography

**Family:** a system serif for the learner's words and titles (`--font-prose`: Iowan Old Style, Charter, Georgia); the system sans for the interface (`--font-ui`); system mono for code (`--font-code`).

**Character:** warm and bookish for reading and writing, native and quiet for controls. Both faces come from the operating system, so the app adds no font weight.

### Hierarchy
- **Title** (serif, 600, 34/40, tracking -0.01em): the note title, page headings. 28/34 on phones.
- **Heading** (600, 21/28): section headings, dialog titles.
- **Body** (serif in notes, 400, 17/28): note text; keep to `--measure` (66ch).
- **UI** (500, 14/20): buttons, labels, rows.
- **Meta** (400, 12/16): times, counts, hints, footers.

### Named Rules
**The No-Shout Rule.** No uppercase labels and no letter-spaced eyebrows. Sentence case everywhere.

## Layout

A left navigation (labelled from 1200 px, icons from 640 px, a drawer below), a note list pane of 280 px, and the page. Content width is capped (`--page-max` 880 px for pages, `--measure` for reading). Spacing is a 4 px grid (`--s-1` to `--s-16`). Touch targets grow to 40 px on coarse pointers. Below 1024 px the note list becomes a slide-over.

## Elevation & Depth

Flat by default; depth is a small step in lightness (`--paper-sunk`, `--paper`, `--paper-float`). Only floating layers cast shadow.

### Shadow Vocabulary
- **Float** (`--elev-float`): menus, popovers, tooltips.
- **Overlay** (`--elev-overlay`): dialogs, with a `--scrim` behind.

### Named Rules
**The Flat-By-Default Rule.** A surface at rest has no shadow and no border.

## Shapes

Gentle, small radii: 6 px controls, 10 px surfaces, 14 px floating layers, pill for badges and switches. No other radius.

## Components

### Buttons
- **Primary:** ink fill, paper text, 6 px radius, 32 px high. One per screen.
- **Quiet** (default): a 5% ink tint. **Ghost:** no fill until hover. **Danger:** danger-coloured text, tinted on hover.
- **Icon button:** 32 px square, tooltip required (`label`).

### Fields
- A soft fill with an inset hairline; on focus a 1 px focus-colour edge and a 3 px wash. Label above, hint or error below.

### Rows
- Two lines at most: title and time, then a snippet. Selected is a soft fill. Pin and other row actions appear on hover or focus.

### Menus, dialogs, tooltips
- Built on Bits UI for focus and keyboard. Menus hold secondary and destructive actions (destructive last, after a separator). Dialog titles are short noun phrases; the primary button is a verb ("Delete note").

### Navigation
- Text rows with an 18 px Lucide icon; active is a soft fill. Counts use `Badge`; the approvals count is amber.

## Do's and Don'ts

### Do:
- **Do** compose every screen from `$lib/ui` and tokens; add missing pieces to `ui/` and `/design` first.
- **Do** make hierarchy with type size, weight and ink steps.
- **Do** keep copy to one short sentence; name the action on the button.

### Don't:
- **Don't** outline things to group them; use space.
- **Don't** use gradients, glows, blur, accent stripes on a card edge, uppercase labels, or bounce easing.
- **Don't** put amber on anything an agent did not do.
- **Don't** show a global banner for a state only some screens need.
