# Open questions and recorded deviations

Two kinds of entries: (A) decisions the owner should confirm (defaults are already chosen in the plan and ADRs, so work can start; the answer may change them), and (B) questions or deviations raised while building. Append new entries at the end of section B in the format shown. Resolve an entry by writing the answer under it and, if it changes a decision, updating the ADR or plan in the same commit.

## A. Owner confirmations: resolved 2026-11-15

Guiding rule from the owner: **performance and usability balance is everything.** Where options tie, pick the faster and more usable one. Answers, in order:

1. **Cron scheduler:** tick loop with a cron parser instead of `node-cron` (ADR-0010). Resolved: yes.
2. **API keys:** environment-only in v1 (ADR-0015). Resolved: yes.
3. **Monthly token cap:** warning only (ADR-0015). Resolved: warning only.
4. **Agent permissions:** the owner configures them from a configuration page. Resolved: Settings > Permissions with instance-wide switches, default approvals for new agents, token ceiling and retention; per-agent grants, hosts and approvals on the agent page. Nothing is forced by the API; the UI warns on read + web without approvals (ADR-0015, ADR-0011).
5. **Chat for every agent:** yes.
6. **Web app delivery:** static SPA served by the API server, because it gives instant navigation, an installable PWA and lazy-loaded heavy views with no server-rendering cost (ADR-0014).
7. **Templates:** all five ship, none runs until the owner turns it on; adding one creates it switched off with an explicit "Turn on" step (ADR-0015).
8. **Container runtime:** the server is bundled with esbuild and runs with plain `node`, not `tsx` (ADR-0014; WP12-T4). Resolved by the performance rule.
9. **Approval timeout and retention:** no approval timeout; run events and snapshots are pruned after 90 days (configurable, 0 = forever); runs, notes and pending approvals are never pruned (ADR-0015, WP3-T6).
10. **Subfolders:** after v1 (WP13).
11. **Cron time zone:** `VIGIL_TZ` or the server zone, per-agent override.
12. **Catch-up window:** 24 hours.
13. **App mark:** the eye-and-flame SVG in `design/ux-spec.md` section 21.
14. **Name check:** search npm, GitHub and trademark databases for "Vigil" before the public launch; a release checklist item. Not done yet.
15. **Telemetry:** none, ever.
16. **Stale approvals:** refuse silently-stale writes with `409 approval-stale`; the owner chooses "Apply anyway" or "Reject" (ADR-0011).
17. **Rename and links:** rewrites the common link forms and shows how many notes will change before confirming (WP5-T4).
18. **Bundling:** see 8.
19. **Live updates:** one event stream with polling fallback (WP4-T9).

## B. Raised while building

Format: `### YYYY-MM-DD <task id>: <question>` then what you assumed and why, then `Answer:` left empty for the owner.

(No open entries yet.)
