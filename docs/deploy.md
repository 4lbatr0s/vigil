# Deploying Vigil

Vigil is one process and one volume. The image serves the API and the web app on port 3001 and keeps everything under `/data`.

## Run with Docker

```
docker build -t vigil .
docker run -d --name vigil \
  -e VIGIL_TOKEN='choose-a-long-random-token' \
  -p 127.0.0.1:3001:3001 \
  -v vigil-data:/data \
  vigil
```

Open http://localhost:3001 and sign in with the token. The image runs as the non-root `node` user and has a health check (`/api/health`).

The container binds `0.0.0.0` inside Docker, and the server refuses to do that without a token. If you forget it, it stops at once with:

```
vigil-server could not start: Refusing to listen on 0.0.0.0 without VIGIL_TOKEN: set a token or bind to 127.0.0.1.
```

`docker-compose.example.yml` is the same thing as a compose file (it will not start without `VIGIL_TOKEN`).

## Variables

| Variable | Meaning |
| --- | --- |
| `VIGIL_TOKEN` | **Required in Docker.** The access token you sign in with (also accepted as `Authorization: Bearer`). Changing it signs everyone out. |
| `VIGIL_LLM_PROVIDER` | `openai` (any OpenAI-compatible endpoint) or `ollama`. |
| `VIGIL_LLM_BASE_URL` | Endpoint URL. |
| `VIGIL_LLM_API_KEY` | Endpoint key. Environment only: never stored, shown or logged. |
| `VIGIL_LLM_MODEL` | Default model; an agent may override it. |
| `VIGIL_MONTHLY_TOKEN_CAP` | Optional monthly token total that only shows a warning. |
| `VIGIL_ALLOWED_HOSTS` | Extra host names the server accepts (your domain behind a reverse proxy). |
| `VIGIL_COOKIE_SECURE` | `1` to always mark the login cookie `Secure`. |
| `VIGIL_TRUSTED_PROXIES` | Extra proxy addresses whose `X-Forwarded-For` is believed (private and loopback proxies already are). |
| `VIGIL_TZ` | Default time zone for cron schedules. |
| `VIGIL_CATCHUP_HOURS` | How old a missed schedule may be and still run once on start (default 24). |

`.env.example` lists every variable with comments. Paths (`VAULT_DIR`, `DB_PATH`, `STATE_DB_PATH`, `CHECKPOINT_DB_PATH`, `SESSION_KEY_PATH`) are preset to `/data/...` in the image.

## Behind a reverse proxy with TLS

Never expose port 3001 directly. Put a proxy with HTTPS in front. Caddy, six lines:

```
notes.example.com {
  reverse_proxy 127.0.0.1:3001
}
```

Then set `VIGIL_ALLOWED_HOSTS=notes.example.com` and `VIGIL_COOKIE_SECURE=1`. Service workers (the installable app and its offline shell) need HTTPS or localhost; the proxy gives you that. The service worker never caches anything under `/api/`.

## Your model

- **Ollama on the host:** `VIGIL_LLM_PROVIDER=ollama`, `VIGIL_LLM_BASE_URL=http://host.docker.internal:11434`, and in compose keep `extra_hosts: ["host.docker.internal:host-gateway"]` (Linux needs it; Docker Desktop has it built in).
- **OpenAI-compatible endpoint:** `VIGIL_LLM_PROVIDER=openai`, `VIGIL_LLM_BASE_URL`, `VIGIL_LLM_API_KEY`, `VIGIL_LLM_MODEL`.

Settings shows what the server sees and has a "Test connection" button.

## Backups

Back up the whole `/data` volume: your vault (`vault/`), the state (`state.db`: agents, runs, approvals, chats), the checkpoints (`checkpoints.db`: paused runs and chat context) and `session.key`. The search index (`index.db`) can be skipped; it rebuilds itself. The vault is plain markdown, so you can also open it with any editor.

```
docker run --rm -v vigil-data:/data -v "$PWD":/backup debian:bookworm-slim tar czf /backup/vigil-data.tgz -C /data .
```

## Upgrading

Pull the new code, `docker build -t vigil .`, then recreate the container with the same volume. Database migrations run on start and only ever add; the index is rebuilt if its format changed.

## Without Docker

```
pnpm install --frozen-lockfile
pnpm build                                   # builds the web app and prints VIGIL_STATIC_DIR
pnpm --filter @vigil/server build            # bundles the server to apps/server/dist/server.mjs
VIGIL_STATIC_DIR=$PWD/apps/web/build VIGIL_TOKEN=... node apps/server/dist/server.mjs
```

Without `HOST` the server listens on 127.0.0.1 only and needs no token.
