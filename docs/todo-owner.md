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
- [ ] **A real hosted key:** add an OpenAI, Anthropic or DeepSeek connection in Settings, press Test and list models, and run an agent; tell the agent what broke (it never sees your key).
- [ ] **Canvas in Obsidian:** open a `.canvas` file made by Vigil in Obsidian (copy it into a vault) and tell the agent whether it shows correctly; also decide whether to keep the small "Svelte Flow" attribution on the board.

- [ ] **Canvas v2 in real Obsidian.** Open a board saved by Vigil (one with locked cards and a right-angle arrow) in Obsidian and check it opens, nothing is lost, and the Vigil fields (`vigilLock`, `vigilStyle`) cause no complaint.
- [ ] **Canvas on a phone.** Touch gestures (long-press menu, pinch) are not built; check what the board does on a real device.
- [ ] **Note editor v3, your eye.** Open a few real notes in the new block editor and say what still feels off (spacing, colours, the block handle, the `/` menu, tables). Notes with syntax it would change open as plain markdown on purpose; tell me which of yours do and I will teach the editor that syntax. Not built yet: folding headings, a hover preview of `[[wikilinks]]`, `![[note]]` embeds, `#tag` completion, find and replace inside the editor, a focus mode, columns, and phone layout.
- [ ] **Search by meaning, try it.** Run `ollama pull nomic-embed-text` (about 270 MB), then Settings, "Search by meaning", type `nomic-embed-text`, Turn on. Watch "notes read" reach the total, ask a question in Ask that uses different words than your note, and open a note to see "Related notes". Built and tested with a stand-in server only: the 4B chat model cannot embed (it answers 501, and the page shows that), so real quality is unchecked.
