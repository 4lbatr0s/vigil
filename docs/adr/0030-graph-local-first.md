# ADR-0030: The graph is local first, with a Map for the whole vault

## Status
Accepted (2026-11-22).

## Context
The Graph page drew the whole vault and answered no question. Like Obsidian's global graph it became a hairball as soon as the vault grew, and it only showed things: the learner could open a note or put it on a canvas. The code also had real defects (see "Fixed" below).

## Decision
- **Connections panel on every note** (toggle in the note header, remembered per browser): a small graph of the note and what is one or two links away (`GET /api/graph?focus=<id>&hops=1..3`), the same as lists (links to, linked from, **mentioned in** without a link; `GET /api/notes/:id/links`), and the agents that touched the note with a link to the run. A link to a note that does not exist shows a **Create note** button.
- **Map page** (`/graph`) with filters (tag, orphans, hide unwritten, search) and lenses: tags (colour by first tag), memory (recall strength), agents (what agents read or wrote in 90 days), plus a **Needs attention** panel: recall checks due, links to notes not written yet, orphans, notes with no cards, notes not touched for 3 months, each opening the note or creating it.
- One renderer, `GraphCanvas`, for both. It is made once and updates in place (no teardown on filter, lens, search or theme change), so the camera and layout do not jump. Colours are resolved from the design tokens by the browser (`graph-theme.ts`) so oklch works in WebGL and a theme switch recolours. The map follows live note and run events.
- The local graph is laid out by rings (`radialLayout`, deterministic); the map uses ForceAtlas2 once per change, starting from the positions already on screen.
- The graph code stays lazy (sigma and graphology never load with the Notes page; the bundle check enforces it).

## Fixed
Rebuild on every List/Graph toggle; two renderers on one container; stale `graphRef` after teardown; colours read once from legacy tokens (no theme change, empty colours once the legacy block goes); timing-dependent layout above 500 notes; per-frame neighbour sets; the hand-rolled `any` renderer type; no refresh when notes or runs change; ghost notes could not be created from the graph; a hidden container made Sigma throw on resize.

## Not done
Truncation above 3000 notes still keeps the newest, not the most connected; unlinked mentions are listed but have no one-click "add link"; the `links` table still has no unique index; no GraphCanvas browser test (WebGL does not run in jsdom: the pure logic is tested, the picture was checked by hand with screenshots).
