# ADR-0027: A free Canvas, saved as JSON Canvas files in the vault

## Status
Accepted (2026-11-17).

## Context
The Graph page is derived from links and cannot be edited, so people could not lay notes out by hand: gather cards, add their own text, group, draw arrows. Obsidian's Canvas is the reference. Markdown files stay the source of truth (ADR-0001), so a board should also be a plain file other tools can open.

## Decision
- **Format:** JSON Canvas 1.0 (jsoncanvas.org, MIT, made for Obsidian): `nodes` of type `text`, `file`, `link` and `group`, and `edges`. A board is `vault/canvases/<id>.canvas`. A `file` node points at a note as `<id>.md` and shows its live title and first lines. Unknown fields are kept on a round trip.
- **Library:** Svelte Flow (`@xyflow/svelte` 1.7.0, MIT, pinned exactly). It is Svelte-native and gives custom nodes, resizing, minimap, controls, snapping and keyboard focus. Rejected: tldraw and Excalidraw (React only; Excalidraw is for hand-drawn diagrams), Konva (a low-level canvas; selection, edges and groups would be ours to build), small Svelte canvas packages (little upkeep). The "Svelte Flow" attribution line the library shows is left on; removing it is allowed by the licence but the maintainers ask for it to stay, so that is the owner's call.
- **Server:** `canvas.ts` validates with zod (unique ids, arrows to existing cards only, preset colors "1" to "6" or hex, at most 2,000 cards and 4,000 arrows, 100,000 characters per text card, 2 MB per file), writes atomically, answers `409` when the file changed since it was opened, and only touches `canvases/<slug>.canvas`. Canvases are not indexed and do not appear among the notes.
- **Web:** `/canvas` (list) and `/canvas/[id]` (the board): text, note, link and group cards; drag, resize, snap to a grid; an arrow dropped anywhere on a card joins its nearest side; moving a group moves the cards inside it; six preset colors (tokens `--canvas-1` to `--canvas-6`); arrow labels; undo and redo; autosave after 800 ms; an Outline list of every card for keyboard use. The route loads on demand, so first load is unchanged.
- **Graph page:** stays (sigma, WebGL) for the whole-vault map; Svelte Flow is DOM-based and meant for hundreds of cards, not thousands.

## Consequences
- A board is only as private as the vault. A text card may hold anything; it is rendered through the same sanitizer as notes. A link card opens only `http(s)` addresses.
- Agents do not read or write boards yet.
- Obsidian may add fields this app does not show; they are kept, not edited.
