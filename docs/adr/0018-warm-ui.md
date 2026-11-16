# ADR-0018: A warmer interface (amends ADR-0005 and ADR-0016)

## Status
Proposed (2026-11-17). Becomes Accepted when the warm pass starts.

## Context
The owner finds the interface cold. Direction chosen: soft and friendly, neutrals kept. A 2025 UXPA randomized study (N = 187) found rounded forms read as warmer and raised perceived ease of use; it tested corner shape, not color, so the palette is a design judgement.

## Decision
- Warm neutrals: dark becomes charcoal with a brown undertone, light a warm off-white paper with white surfaces. Starting values are in the approved plan and are tuned against `contrast.test.ts` (at least 4.5:1) before use.
- Radius 8px on controls and 12px on cards and dialogs; a softer shadow token; roomier rows and panels.
- Voice: second person, plain and kind, no guilt, inviting empty states. Simple line illustrations from tokens, gentle 140 to 200 ms motion, reduced motion honoured, no emoji.
- Amber stays reserved for agent life. Each agent gets a name and a small lantern glyph.

## Consequences
- `docs/design/ui.md` and `docs/design/ux-spec.md` are updated with the code. Colors still come only from `app.css`.
