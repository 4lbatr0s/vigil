# Vigil

A self-hosted notes app where your AI agents keep vigil: reading, writing, and running on schedules.

Your notes are plain markdown files. Agents read them, write new ones, and run on a schedule, when notes change, or when you chat with them. Every write an agent makes is saved first, so one click undoes it.

- Markdown files are the source of truth. SQLite is a disposable search index.
- Bring your own model: any OpenAI-compatible endpoint, or Ollama for fully local use.
- Single user, single process, one Docker volume.

## The Morning Digest, in five steps

1. Open **Agents** and press **Add** on "Morning digest". It is created switched off.
2. Read what it may do on its page, then press **Turn on** (or **Run once now**).
3. At 07:00 it reads what changed yesterday and writes one note, `Digest <date>`.
4. The note appears in your list with an amber dot ("written by morning-digest"); the run's log is under **Agents**.
5. Don't like it? Open the run and press **Undo this run**.

## Run it

With Docker:

```
docker build -t vigil .
docker run -d --name vigil -e VIGIL_TOKEN='choose-a-long-random-token' -p 127.0.0.1:3001:3001 -v vigil-data:/data vigil
```

Open http://localhost:3001 and sign in with the token. More (compose, reverse proxy, backups, upgrading): [`docs/deploy.md`](docs/deploy.md).

For development (Node 24, pnpm 11):

```
pnpm install
pnpm --filter @vigil/server dev   # API on http://127.0.0.1:3001
pnpm --filter @vigil/web dev      # UI on http://localhost:5173, proxies /api
pnpm typecheck && pnpm test       # the gate
```

## Connect a model

Open **Settings, AI models, Add a connection**: pick Ollama (on this computer), LM Studio, OpenAI, Anthropic (Claude), DeepSeek, OpenRouter, Groq or any OpenAI-compatible address, paste a key if the service needs one, press **Test and list models**, choose a model and save. Keys are stored encrypted on this computer and never shown again. An agent uses the default connection unless you pick another on its page.

Prefer the environment? It still works and shows up as a read-only connection:

```
# Ollama on this machine
VIGIL_LLM_PROVIDER=ollama VIGIL_LLM_MODEL=llama3.1

# Any OpenAI-compatible endpoint
VIGIL_LLM_PROVIDER=openai
VIGIL_LLM_BASE_URL=https://api.openai.com/v1
VIGIL_LLM_API_KEY=...
VIGIL_LLM_MODEL=...
```

Saved keys are encrypted with a key from `VIGIL_SECRET_KEY` or the file `secret.key` next to `state.db`; a backup that holds both files holds your keys. Ollama is asked for a 16,384-token window (`VIGIL_LLM_NUM_CTX` changes it); the 4,096 default can leave a thinking model with an empty reply. Every variable is listed in `.env.example`.

## What agents can do

An agent is a system prompt, a list of tools, a trigger and a token budget.

- **Tools:** read notes, write notes, fetch web pages from hosts you list, and call other agents (one level deep, inside the first agent's budget). There is no shell and no other network access.
- **Triggers:** manual, a cron schedule (with one catch-up run after downtime), or a heartbeat that runs only when the notes it can read changed.
- **Chat:** talk to any agent; the conversation is kept across restarts and can be saved as a note.
- **Snapshots and undo:** a note is saved before an agent writes it. Undo restores it, and refuses if you edited the note since.
- **Strict mode:** the agent's writes wait in **Approvals** until you accept them, with a diff. A paused run survives a restart.
- **Permissions:** Settings has switches that turn a tool off for every agent, a ceiling for token budgets, and run-history retention.
- **Graph:** notes and agents as a graph; recent notes glow, agent reads and writes are dashed lines. A Memory view colors notes by how much of them you remember.
- **Other agents (MCP):** off by default. Switch it on in Settings and tools like Claude Code or Claude Desktop can search and read your notes at `/api/mcp`, and, with a second switch, write notes. Each write is a run you can undo.
- **Learner status:** agents with the notes-reading tool can see your study memory (cards due, exam dates, recall rate, cards that keep slipping), which the weekly study review uses.

## Study

Learning research is clear that testing yourself and spacing reviews out beat rereading (Dunlosky et al. 2013; Adesope et al. 2017), and that an AI which does the thinking for you can hurt more than it helps (Bastani et al. 2025). So Vigil's study helpers do the chores and leave the thinking to you.

- **Cards live in your notes.** `Question :: Answer` on one line, or `{{hidden words}}` inside a sentence. Plain markdown, readable anywhere.
- **Spaced review.** The Study page shows what is due, you type your answer first (optional), reveal it, and rate it with keys 1 to 4. Scheduling uses FSRS. There are no streaks or scores.
- **Make cards.** The Card maker agent proposes cards from a note; you edit, keep or drop each one before anything is saved. It has no tools, so it cannot change or read anything else.
- **Card hints.** When the card maker proposes cards, Vigil flags ones that are hard to learn from (long answers, lists, yes or no, several blanks). Cards you keep forgetting get their own list so you can reword or split them.
- **Exam dates.** Give a note or tag a date and reviews are paced to land before it (the best gap depends on when the test is; Cepeda et al. 2008). The pacing steps are a design choice, shown to you, and removed by deleting the date.
- **Recall checks.** Write what you remember of a whole note, an agent shows what you covered and missed from the note itself, and the note comes back after 1, 3, 7 and 21 days.
- **Study outline.** Paste text and get headings with a question each, answers left empty for you to write in your own words.
- **Your data stays yours.** Download your cards as text for Anki, or import an Anki plain-text export (review history is not imported). A calendar helps you find daily notes, and settings let you choose new cards per day and how sure the scheduler should aim to keep you.
- **Ask your notes and gap check.** Ask a question and get an answer built only from your own note lines, each claim marked with the line behind it, or "your notes do not cover this". Paste an article and see what your notes already have, lack or contradict.
- **What you got wrong.** After a recall check you can keep the points you got wrong; the next check shows them first and the card maker writes cards on them. You cross each one off.
- **Capture and pictures.** A Capture box on Today adds a line to your Inbox note. If you switch it on, the card maker and recall checker can see the pictures in a note (they go to your model provider).
- **Tutors.** A Socratic tutor, an explain-it-back coach and a quiz master ask first, hint second and answer last, using only the note you give them.

No claim is made that this multiplies learning many times over: the research supports a solid, practical gain from better habits, with the busywork taken off your hands.

## Safety model

- **Local by default.** The server binds 127.0.0.1, sends no CORS headers and checks the Host and Origin headers. Any other bind needs `VIGIL_TOKEN`; the browser signs in with it and gets a signed, HttpOnly, SameSite=Strict cookie.
- **Note text and web pages are untrusted.** They may contain instructions; agents are told to treat them as data, and can only use the tools they were granted.
- **Web fetch is allowlisted.** An agent reaches only the exact hosts you list, never local or private addresses, with every address it fetches written in its run log. Allowed hosts can still receive data in a URL, which is why agents that read notes and fetch the web start with approvals on.
- **Cost is bounded.** Per-run token budget, a step limit, one run per agent, and an optional monthly warning level.

Design decisions are recorded in [`docs/adr/`](docs/adr/), the threat model in [`docs/spec/threat-model.md`](docs/spec/threat-model.md).

## Backups

Back up the whole `/data` volume (vault, state, checkpoints, session key). The index rebuilds itself. See [`docs/deploy.md`](docs/deploy.md).

## For contributors and coding agents

Start with [`AGENTS.md`](AGENTS.md): it lists the documents to read, the task list in `docs/spec/progress.md`, and the hard rules.

## License

AGPL-3.0, see [`LICENSE`](LICENSE).
