# To do: needs the owner

Only you can do these (a decision, an account, a real device, or publishing). Tick an item when it is done and tell the agent the result where it says so. The list the agent works through alone is [`todo-agent.md`](todo-agent.md). History is in `spec/progress.md`.

## Decisions and publishing
- [ ] **Name check for "Vigil":** search npm, GitHub and trademark databases; write the result in `spec/open-questions.md`.
- [ ] **Announce:** decide when to publish release notes and announce.
- [ ] **Demo:** record the 20-second Morning Digest demo (under 5 MB) and put it at the top of the README.
- [ ] **Release checklist:** the items in `spec/implementation-plan.md` section 10 that need a human.

## Real devices and real tools (tell the agent what you saw)
- [ ] **Phone:** open the app on a real phone; report layout problems (the browser window here cannot be resized).
- [ ] **Share to Vigil:** install Vigil as an app on your phone, share a link or text to it from another app, and report whether it arrives in the Capture page.
- [ ] **Anki:** import a file from Study, "Download cards", into real Anki; report any problem.
- [ ] **MCP:** switch it on in Settings and connect Claude Code or Claude Desktop to `/api/mcp`; report what works.
- [ ] **Run the evals:** `VIGIL_LLM_PROVIDER=ollama VIGIL_LLM_MODEL=<model> pnpm --filter @vigil/server eval` for your local model, then again with a larger or hosted model, and tell the agent both summaries. Then the same with `--agent --trials 3` added (agent evals: tool use, approvals, a planted instruction). It uses a temp folder and never touches your notes.
- [ ] **A larger model:** try a model bigger than the local 4B on filing (Inbox), the weekly study review, recall checks and Ask your notes; tell the agent the model name and how it did.

## Your setup
- [ ] **Demo server:** the API on port 3001 is stopped. Say which vault it should use (or start it yourself with `pnpm --filter @vigil/server dev`).
- [ ] **Hosted model (optional):** if you want a hosted model, set `VIGIL_LLM_*` in your own environment. Never paste a key into the chat.
- [ ] **Embedding model (optional):** if you want Ask to find notes by meaning and not only by words, run `ollama pull nomic-embed-text` (a download of a few hundred MB). Then tell the agent, which will measure full-text search against embeddings on a temp vault before building anything.
- [ ] **A real hosted key:** add an OpenAI, Anthropic or DeepSeek connection in Settings, press Test and list models, and run an agent; tell the agent what broke (it never sees your key).
- [ ] **Canvas in Obsidian:** open a `.canvas` file made by Vigil in Obsidian (copy it into a vault) and tell the agent whether it shows correctly; also decide whether to keep the small "Svelte Flow" attribution on the board.

- [ ] **Canvas v2 in real Obsidian.** Open a board saved by Vigil (one with locked cards and a right-angle arrow) in Obsidian and check it opens, nothing is lost, and the Vigil fields (`vigilLock`, `vigilStyle`) cause no complaint.
- [ ] **Canvas on a phone.** Touch gestures (long-press menu, pinch) are not built; check what the board does on a real device.
- [ ] **Note editor v3, your eye.** Open a few real notes in the new block editor and say what still feels off (spacing, colours, the block handle, the `/` menu, tables). Notes with syntax it would change open as plain markdown on purpose; tell me which of yours do and I will teach the editor that syntax. Not built yet: folding headings, a hover preview of `[[wikilinks]]`, `![[note]]` embeds, `#tag` completion, find and replace inside the editor, a focus mode, columns, and phone layout.
- [ ] **Search by meaning, try it.** Run `ollama pull nomic-embed-text` (about 270 MB), then Settings, "Search by meaning", type `nomic-embed-text`, Turn on. Watch "notes read" reach the total, ask a question in Ask that uses different words than your note, and open a note to see "Related notes". Built and tested with a stand-in server only: the 4B chat model cannot embed (it answers 501, and the page shows that), so real quality is unchecked.

## Agent work of 2026-11-25: your part
- [ ] **Push or merge:** the branch `fix/p0-agent-runtime` holds the P0 fixes, the notifications, the daily cap, the state note, the run page changes and the agent evals, and it is ahead of the pushed copy. Say "push" when you want it pushed, and decide when it goes into `main` (`main` is 17 commits ahead of `origin/main` and was not touched).
- [ ] **Pull a model:** the local Ollama has no model (`curl localhost:11434/api/tags` shows an empty list). Pull one (for example `ollama pull qwen3:4b`) so the evals and the live checks can run.
- [ ] **Run the agent evals** (see "Run the evals" above) and tell the agent the summary. This unlocks agent items 30 and 31. Add `--save ~/vigil-evals` to keep each result; later runs then name the cases that newly fail. A nightly crontab line is in the header of `apps/server/src/evals/run.ts`.
- [ ] **DeepSeek check:** add a DeepSeek connection (Settings, Models), Test it, and run an agent with a tool and thinking on. Item 17's fix is tested against a fake endpoint only. Tell the agent if you see an HTTP 400.
- [ ] **Look at the new screens:** the run page (step times, "Setup" fingerprint, Run again) and the agent page ("Remember where it stopped", "Token limit per day"). Say what feels wrong.
- [ ] **Decide the caps:** the hard monthly cap (`VIGIL_MONTHLY_TOKEN_HARD_CAP`, ADR-0032) is off by default. Pick a number, or leave it off.
- [ ] **Webhook (optional):** set `VIGIL_WEBHOOK_URL` if you want a message when an approval waits or a run fails (a chat or ntfy URL). It carries no note text.

## Shire server (Vigil deploy and the rest of the move)
Details are in `~/shire-ops/HANDOFF.md`. You run every `sudo` command in iTerm and paste the output.
- [ ] **Deploy Vigil:** `ssh shire`, then `/srv/shire/bin/deploy-vigil-first.sh` (asks for the sudo password). Then `ssh -L 3001:127.0.0.1:3001 shire`, open `http://localhost:3001`, sign in with the `VIGIL_TOKEN` from `/srv/shire/secrets/apps/vigil/vigil.secrets.env` (never paste it into the chat). The deployed ref is the pushed branch, so the newest commits are not in it until you push and deploy again.
- [ ] **Give the server a model:** Vigil in its container cannot reach Ollama (it listens on 127.0.0.1:11434). Either add a hosted connection in Vigil's Settings, or tell the agent to set up Ollama for the Docker network.
- [ ] **Caddy and the tunnel:** run `caddy validate` on the changed Caddyfile (the client-IP change is untested), then start Caddy and `cloudflared` (the domain is active on Cloudflare and the token is saved). Vigil stays private: no public hostname.
- [ ] **Decide about commit `df06d6f` in `shire-ops`:** it holds your earlier Caddy and Cloudflare work together with the Vigil change. Say if it should be split.
- [ ] **Placeholders:** the real Clerk webhook secret and the real `wander` domain replace the placeholders in the env files.
- [ ] **Backups, SSH hardening, a reboot test:** each one step at a time with the agent.
- [ ] **Clean up secrets:** delete `~/.render_api_key` and revoke the GitHub token `shire-ghcr-read`.

## Added 2026-11-25 (second batch)
- [ ] **Try "Check tools":** Settings, AI models, press **Check tools** on each connection (it spends a few tokens). Tell the agent what it says for your local model and for a hosted one.
- [ ] **Try MCP client tokens:** in Settings, Other agents, create a client for Claude Code or Claude Desktop, use its token instead of the global one, write a note through it, and check that the run log names the client and that Revoke stops it. Not yet tried with a real MCP client.
- [ ] **Try approval for web pages:** on an agent with web access, switch on "Ask me before it reads a web page", run it, and check the Approvals page.
- [ ] **Two small wording calls:** the Approvals page shows an address twice (row and review), and two switch labels say "it" where another says "this agent". Say if you want them changed.
