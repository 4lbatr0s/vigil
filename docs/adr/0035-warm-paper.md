# ADR-0035: Warm paper and a serif for the learner's words

## Status
Accepted (2026-11-26, chosen by the owner). It supersedes decision 4 of ADR-0029 (one system sans; the neutral palette). Every other decision of ADR-0029 stays: Bits UI for behaviour, tokens only, `$lib/ui` as the one component home, the lint rules, amber for agent life only, flat by default.

## Context
After the ADR-0029 migration the owner found the app "not nice, not warm, not useful, not easy to handle". The tokens had a chroma of 0.01 or less (near grey) and one system sans for everything. Competitor research (2026-11-26: Bear, iA Writer, Things, Craft, Reflect, Capacities) shows that warmth in calm writing apps comes mostly from typography and a paper-like ground, not from decoration. ADR-0029 dropped the old cream palette and serif because that cluster is the common "AI default" look; the fault named there was being the default (saturated cream, Newsreader, display serif everywhere), not warmth itself.

## Decision
1. **Ground:** warm paper in light (`oklch(97% 0.026 78)`), warm charcoal in dark (`oklch(21.5% 0.02 55)`). A first, paler version (chroma 0.013) was judged not warm enough by the owner the same day; the chroma was doubled but stays short of saturated cream. The sunk and float surfaces are small lightness steps of the same hue.
2. **Ink:** warm near-black in three steps. Each step is at least 4.5:1 on all three surfaces in both themes.
3. **Type:** a system serif (`Iowan Old Style, Charter, Source Serif, Georgia`) for the learner's words (note text, chat and answers) and for titles; the system sans stays for controls, labels and section headings; mono for code. No web font is downloaded, so the 180 KB first-load budget is unchanged.
4. **Reading size:** body 17/28, measure 66ch, title 34/40 (28/34 on phones).
5. Amber stays reserved for agent activity. No new accent colour is added until a screen needs one for the learner's own progress; it would then be added here first.

## Consequences
- `tokens.css`, `DESIGN.md` and `PRODUCT.md` change together; `ui-rules.md` is unchanged because its rules name roles, not values.
- The font differs a little per platform (Iowan on Apple, Charter or Georgia elsewhere). That is accepted for zero font weight.
- The legacy tokens in `app.css` (graph, canvas colours) are not part of this change.
