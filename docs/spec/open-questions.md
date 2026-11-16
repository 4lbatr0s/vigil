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

### 2026-11-15 WP4-T10: the editor chunk is about 240 KB gzip
First measure of the "/" route: 296 KB gzip with CodeMirror (`basicSetup`), `marked` and DOMPurify in the entry. I moved the editor and preview behind dynamic `import()`, so the first load is 83 KB gzip (budget 180 KB, enforced by `scripts/check-bundle-size.mjs`) and the editor loads right after. I did not trim `basicSetup` (autocomplete, search, lint) because WP5 rebuilds the editor; trim there and measure again.
Answer:

### 2026-11-15 WP4-T10: text-safe color tokens added
Dark `--err` (4.32:1 on `--bg`) and light `--amber` (3.63:1) fail 4.5:1 as text. I added `--err-ink` and `--amber-ink` for text use (documented in `docs/design/ui.md`) and kept `--err`/`--amber` for dots and borders. `contrast.test.ts` enforces it.
Answer:

### 2026-11-15 WP4-T10: typing-latency test not written
The live-preview plugin it measures arrives in WP5-T1, so the 50 ms guard test belongs there.
Answer:

### 2026-11-15 WP9: chat tables are migration 6, and replies are not streamed token by token
Migration 5 was used by approvals (WP8), so the chat tables are migration 6. The model adapter interface is `invoke(messages)`, so a turn streams each model reply as one `token` line when the call finishes (the plan allows this fallback) plus `tool` lines as tools run. True per-token streaming needs `stream()` on `ChatModel` and the adapters; worth doing before the public launch.
Answer: 2026-11-16: done. `ChatModel.stream` is optional; when it exists and a turn is watched, the runtime sends `delta` lines per piece and concatenates the chunks into the final message (tool calls included). Without `stream`, the old whole-reply `token` line is used.

### 2026-11-15 WP9: chat history is not trimmed
Every turn re-sends the whole conversation (kept in the checkpoint), and each turn has its own budget, so a very long chat will hit `budget-exceeded` on its own. Summarising or trimming old messages is a post-v1 item.
Answer: 2026-11-16: trimmed. `history.ts` sends the system message plus the newest whole turns that fit 48,000 characters (about 12k tokens), starts at a user message so no tool result is orphaned, and never drops the current turn. The full conversation stays in the checkpoint and the stored chat. Summarising older turns is still not done.

