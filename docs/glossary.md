# Vigil Glossary

- **Vault** — the directory of markdown files; the source of truth.
- **Note** — one markdown file in the vault (id, title, body, frontmatter).
- **Index** — the disposable SQLite database derived from the vault (search, links, graph, schedules).
- **Agent** — a named, configured worker: { system prompt, tool allowlist, trigger, budget }.
- **Archetype** — an agent's trigger kind: chat, scheduled, or heartbeat.
- **Run** — one execution of an agent; everything it did is recorded.
- **Run log** — the durable record of a run: prompt, tool calls, outputs, token spend.
- **Template** — a preset agent (prompt + schedule + tools) that users instantiate with one click.
- **Heartbeat** — a light, frequent agent run that acts only on change.
- **Cron** — the scheduled-agent trigger; standard crontab syntax.
- **Digest** — a note an agent compiles from other notes (e.g. the Morning Digest).
- **BYOK** — bring your own key; user-configured OpenAI-compatible endpoint or Ollama.
- **Strict mode** — per-agent setting: writes queue for user approval instead of applying.
- **Snapshot** — the automatic pre-write copy that makes agent writes undoable.
- **Graph** — the Sigma.js view of the vault: notes as nodes, links and agent relations as edges.
- **Agent edge** — a dashed graph edge between an agent and the notes it watches or wrote.
- **Provenance** — who wrote what: human-edited vs agent-written, visible in UI and index.
