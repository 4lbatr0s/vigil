# ADR-0026: Model connections are added in Settings, with keys stored encrypted

## Status
Accepted (2026-11-17). Amends ADR-0003 (keys were environment-only).

## Context
People expect to connect a model the way other apps let them: choose Ollama, OpenAI, Anthropic, DeepSeek or any OpenAI-compatible address, paste a key, pick a model. Environment variables alone made that a file-editing job and left the "No AI model" banner with nothing to click.

## Decision
- **Connections.** A connection is a kind (`openai`, `anthropic`, `ollama`), an address, an optional key and a default model. Many can exist; one is the default; an agent may name one (`connection` on the agent). Order of choice: the agent's, the default, the first saved, then `VIGIL_LLM_*` from the environment, which still works and is shown as a read-only "Environment" connection.
- **Keys.** Typed in Settings, encrypted with AES-256-GCM (random IV per value, authenticated) into `connections.api_key_enc` (state migration 14). The 32-byte key comes from `VIGIL_SECRET_KEY`, or from a 0600 file `secret.key` beside `state.db`. A key is write-only: no response, log, run event, error or status ever contains it; every key seen is registered with `redact`.
- **Probing.** `POST /api/connections/probe` lists models (`/models`, `/api/tags`, Anthropic `/v1/models`) for an unsaved address or a saved connection by id (its saved key is used server-side, never sent back). One GET, 8 seconds, 1 MB cap, no redirects followed.
- **Endpoints.** The address is typed by the signed-in owner, so local and private addresses must work; there is no block list. Only `http(s)` without credentials in the URL is accepted.
- **Anthropic.** Through `@langchain/anthropic` 1.6.1 (pinned exactly, peer `@langchain/core` ^1.4.1 matches ADR-0009).
- **Ollama** keeps a 16,384-token window (`VIGIL_LLM_NUM_CTX`).

## Consequences
- Someone who holds both `state.db` and `secret.key` can read the keys; a copy of `state.db` alone cannot. Backups that include both files include the keys; the README says so. Deleting `secret.key` makes saved keys unreadable (the app says so and asks for them again).
- A hosted-model key now lives on disk, which ADR-0003 avoided. The owner chose this for usability (2026-11-17); environment-only setups keep working unchanged.
- Switching the default or editing a connection applies to the next run, with no restart.
