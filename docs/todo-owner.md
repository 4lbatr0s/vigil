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
- [ ] **A larger model:** try a model bigger than the local 4B on filing (Inbox), the weekly study review, recall checks and Ask your notes; tell the agent the model name and how it did.

## Your setup
- [ ] **Demo server:** the API on port 3001 is stopped. Say which vault it should use (or start it yourself with `pnpm --filter @vigil/server dev`).
- [ ] **Hosted model (optional):** if you want a hosted model, set `VIGIL_LLM_*` in your own environment. Never paste a key into the chat.
- [ ] **Embedding model (optional):** if you want Ask to find notes by meaning and not only by words, run `ollama pull nomic-embed-text` (a download of a few hundred MB). Then tell the agent, which will measure full-text search against embeddings on a temp vault before building anything.
