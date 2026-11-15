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

Environment only (keys are never typed into the app, stored, or shown):

```
# Ollama on this machine
VIGIL_LLM_PROVIDER=ollama VIGIL_LLM_MODEL=llama3.1

# Any OpenAI-compatible endpoint
VIGIL_LLM_PROVIDER=openai
VIGIL_LLM_BASE_URL=https://api.openai.com/v1
VIGIL_LLM_API_KEY=...
VIGIL_LLM_MODEL=...
```

Settings shows the connection and has a "Test connection" button. Every variable is listed in `.env.example`.

## What agents can do

An agent is a system prompt, a list of tools, a trigger and a token budget.

- **Tools:** read notes, write notes, fetch web pages from hosts you list, and call other agents (one level deep, inside the first agent's budget). There is no shell and no other network access.
- **Triggers:** manual, a cron schedule (with one catch-up run after downtime), or a heartbeat that runs only when the notes it can read changed.
- **Chat:** talk to any agent; the conversation is kept across restarts and can be saved as a note.
- **Snapshots and undo:** a note is saved before an agent writes it. Undo restores it, and refuses if you edited the note since.
- **Strict mode:** the agent's writes wait in **Approvals** until you accept them, with a diff. A paused run survives a restart.
- **Permissions:** Settings has switches that turn a tool off for every agent, a ceiling for token budgets, and run-history retention.
- **Graph:** notes and agents as a graph; recent notes glow, agent reads and writes are dashed lines.

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
