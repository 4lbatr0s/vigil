# ADR-0012: Graph view with Sigma.js, a 2D overlay for dashed edges, and a list fallback

## Status
Accepted (2026-11-15). Implements v1 scope decision 12.

## Context
The graph must show notes as nodes, plain link edges, dashed agent-note edges, and amber glow by recency (decision 12, ADR-0005). Sigma.js renders with WebGL and has no built-in dashed edge program. Some browsers and test environments lack WebGL. A graph alone is not keyboard accessible.

## Decision
- Libraries: `sigma`, `graphology`, `graphology-layout-forceatlas2`. At implementation time check current stable versions and typings, pin exact versions, and record them here. Pinned: `sigma` 4.0.6, `graphology` 0.26.0, `graphology-layout-forceatlas2` 0.10.1. Layout runs in the library's web worker above 500 nodes and synchronously below.
- Data: `GET /api/graph` (server computes degree; dangling links become ghost nodes; agent edges come from `agent_touches` for the last 90 days; cap 3000 nodes, most recent plus neighbors, `truncated: true`).
- **Dashed agent edges:** hide agent edges in the WebGL layer and draw them on a 2D canvas overlay in Sigma's `afterRender` using `setLineDash([4, 4])`, positions from `sigma.graphToViewport`, amber at 40% alpha. Link edges remain normal WebGL edges.
- **Glow:** drawn on the same 2D overlay as the dashed edges (a radial amber gradient around each recent note, which keeps the node itself visible and needs no extra graph nodes); alpha `max(0, 1 - ageDays/14)` in amber; no glow after 14 days.
- **Accessibility and fallback:** a list view (grouped by connection count, same actions) is always reachable by a toggle and is the automatic fallback when WebGL is unavailable. Reduced motion disables camera animation.
- Only pure functions are unit tested (`buildGraph`, `glowAlpha`, `neighborSet`); rendering is verified manually and recorded in the PR.

- **Sigma 4 notes:** its `styles` setting replaces the defaults, so the view spreads `DEFAULT_STYLES` and overrides only label and backdrop colors (from tokens). Sizes are in sigma units (about a third of a pixel of radius). Agent edges are hidden in the edge reducer; agents are hollow nodes with a ring stroked on the overlay. Overlay colors are `color-mix()` of token values, so no raw colors live in code.

## Consequences
- Three dependencies, pinned. The overlay approach keeps dashed styling without writing a custom WebGL program.
- If the overlay becomes a performance problem on very large graphs, the 3000-node cap bounds it.
