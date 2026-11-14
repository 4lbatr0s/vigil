# Vigil Conventions

Code standards every worker follows. Contradicting an ADR requires a new ADR first.

## TypeScript & packages
- strict: true everywhere; no `any` unless the line carries a comment justifying it; `noUncheckedIndexedAccess` stays on.
- ESM only (`"type": "module"`).
- `@vigil/shared` owns ALL cross-boundary types and zod schemas. Backend and UI import from it; never duplicate a type locally.
- Only the server touches the filesystem or the SQLite index; the web app talks to the server API, nothing else.

## API
- REST, JSON, all routes under `/api`.
- Response envelope: success `{ "data": ... }`; failure `{ "error": { "code", "message" } }` with a correct HTTP status.
- kebab-case URL segments; camelCase JSON fields.

## Errors
- Server throws typed `AppError(code, message)`; one middleware maps it to the envelope. No silent catches; no string-typed errors across boundaries.

## Testing & acceptance
- vitest. Any module containing logic ships at least one test.
- "Done" is a runnable command's output, never a claim. Briefs carry exact acceptance commands.

## Git
- Conventional commits: `feat:`, `fix:`, `chore:`, `docs:`. Small commits, one concern each.
- Nothing secret in the repo (`.env` is gitignored); no keys in code or notes.

## UI (per ADR-0005)
- All colors/spacing/typography come from docs/design/ui.md tokens; raw hex outside the tokens file fails review.
- Semantic type rule: serif = human voice, mono = machine voice.
- SVG icons (Lucide); never emoji as icons.
- Contrast ≥ 4.5:1; visible keyboard focus; `prefers-reduced-motion` respected.
- UI tasks run the two-pass rule: plan tokens/layout first, self-critique against generic AI-default looks (cream+serif+terracotta, near-black+acid-green, uniform rounded card grids, all-caps eyebrows), revise, then build.
