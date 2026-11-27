---
name: vigil-ui-review
description: Use after any Vigil UI change, before saying it is done. Runs the tests, takes screenshots at phone, tablet and desktop widths in both themes, and checks the result against the design rules and Impeccable's detector.
---

# Reviewing Vigil UI

"It compiles" is not done. Look at it.

## Steps

1. **Gate:** `pnpm typecheck && pnpm test`. `ui-lint.test.ts` must pass; do not weaken or skip it.
2. **Run it** on a throwaway vault, never the owner's: `VAULT_DIR`, `STATE_DB_PATH` and `DB_PATH` pointing to a temp directory, server on a spare port, web with `VIGIL_API_URL` set to it (see `docs/design/research/README.md`).
3. **Screenshot** the changed screens with Playwright (`npx playwright install chromium` in a scratch directory outside the repo) at 390x844, 1024x768 and 1440x900, light and dark (`colorScheme`). Open the images and look at them.
4. **Judge against the rules** in `docs/design/ui-rules.md`. For each screen answer in one line each:
   - What is the one primary action? Is it obvious?
   - Is hierarchy made by type and space, or by boxes?
   - Is anything outlined that is not a text field?
   - Any paragraph of copy that could be one sentence or nothing?
   - Does it work at 390 px with no horizontal scroll?
5. **Detector:** from `apps/web`, run `../../.claude/skills/impeccable/scripts/impeccable detect --json --changed`. Fix findings.
6. **Critique** a new screen with the `impeccable` skill's `critique` command. Fix what it finds or say why not.
7. **Keyboard:** tab through the screen once; every control reachable, focus visible, Escape closes overlays.
8. Report what you checked, what you saw, and what is still wrong. Do not say "looks good" about something you did not open.
