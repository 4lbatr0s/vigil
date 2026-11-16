# Vigil Design Tokens — "Quiet Instrument" (ADR-0005)

Single source of truth for all UI. Components may not use raw hex values outside this file.

## Palette (dark default)
| Token | Dark | Light | Role |
| --- | --- | --- | --- |
| --bg | #161412 | #FAF6F0 | app background |
| --surface | #1F1C1A | #FFFDF9 | cards, panels, editor chrome |
| --hairline | #302C28 | #E9E1D6 | all dividers and borders |
| --ink | #F2EDE6 | #2A2521 | primary text |
| --ink-muted | #A89F95 | #6B6258 | secondary text, labels |
| --amber | #E8A33D | #B47612 | agent life ONLY: active runs, agent-written notes, graph glow, lantern flicker |
| --ok | #4EA36A | #2E7D4F | run success |
| --err | #C75450 | #B03A36 | run failure (dots, borders) |
| --err-ink | #DD6A66 | #B03A36 | error text (>= 4.5:1 on --bg and --surface) |
| --amber-ink | #E8A33D | #8F5C0A | amber used as text (>= 4.5:1) |
Dark is default. Light is a first-class theme, not an afterthought.

## Typography
| Voice | Face | Use |
| --- | --- | --- |
| Human prose | Newsreader (variable) | note bodies, rendered markdown |
| Machine | IBM Plex Mono | agent output, run logs, cron expressions, timestamps, file paths |
| Chrome | Schibsted Grotesk | nav, buttons, labels, settings, editor UI |
Scale: 13 (labels) / 15 (UI) / 17 (prose base) / 20 (h3) / 26 (h2) / 34 (h1). Prose line-height 1.6, reading column max 68ch. Mono line-height 1.5.

## UI v2 additions (ADR-0016)
| Token | Role |
| --- | --- |
| --surface-hover | hover and selected rows and buttons (mixed from --surface and --ink) |
| --surface-raised | card-like panels such as review and Today (mixed, never a new hue) |
| --shadow-pop | the only shadow: floating layers (menus, palette, toolbars, slide-over, drawer) |
| --rail-width / --nav-width | 56px icon rail / 200px labelled navigation (from 1200px) |
Breakpoints: wide >= 1200 (labelled nav), 1024 to 1199 and 640 to 1023 (icon rail; list pane is a slide-over below 1024), < 640 (drawer, single column).

## Layout & structure
- Hairlines carry structure; shadows are banned except `--shadow-pop` on floating layers and focus rings (ADR-0016).
- Border radius (ADR-0018): 8px on controls, 12px (`--radius-lg`) on cards and dialogs.
- Spacing on a 4/8 grid: 4, 8, 12, 16, 24, 32, 48.
- Left-aligned text everywhere; centered only in empty states.

## Motion
- State changes: 80–140ms, ease-out. No bounce, no parallax, no scroll-triggered reveals.
- The ONE orchestrated moment: the lantern flicker — when a scheduled agent lands a note, its title pulses amber once (~600ms).
- prefers-reduced-motion: the flicker becomes a static amber dot.

## Component stances
- Agent rows are ledger rows: mono timestamp, serif title, status dot (ok/err/running-amber). Not SaaS cards.
- Run log: terminal-grade but quiet — mono, muted ink, amber only for the running marker.
- Command palette (⌘K) is the primary navigation.
- Graph: dark canvas, node glow = recency in amber, dashed edges for agent relations.
- Icons: Lucide, 1.5px stroke, no emoji anywhere.

## Accessibility floor
Contrast ≥ 4.5:1 (test amber-on-dark for text; amber as text only ≥ 13px medium). Visible focus ring on all interactive elements. Keyboard-reachable everything. Reduced motion honored.
