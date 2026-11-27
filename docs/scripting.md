# Scripting Vigil with the HTTP API

Everything the web app does goes through the HTTP API, so a script can do it too. This page shows the common jobs with `curl`. It does not list every route: the routes are in `apps/server/src/http.ts`.

## Before you start

- The server listens on `http://127.0.0.1:3001` by default. The examples use `$VIGIL` for the address.
- If `VIGIL_TOKEN` is set, add the header `Authorization: Bearer $VIGIL_TOKEN` to every call. Read the token from your own environment. Never paste it into a shared file or a chat.
- The `Host` header must be `localhost`, `127.0.0.1` or a name in `VIGIL_ALLOWED_HOSTS`. A call from a reverse proxy needs its domain in that list.
- Every answer is JSON: `{"data": ...}` on success and `{"error": {"code": "...", "message": "..."}}` on failure.

```sh
export VIGIL=http://127.0.0.1:3001
AUTH=(-H "Authorization: Bearer $VIGIL_TOKEN")   # leave this line out when no token is set
```

## Start an agent and read its answer

```sh
# Start a run (answers 202 at once; the run goes on in the background).
RUN=$(curl -s "${AUTH[@]}" -X POST "$VIGIL/api/agents/morning-digest/run" \
  -H 'content-type: application/json' -d '{"task":"Summarize yesterday."}' | jq -r .data.id)

# Wait until it is no longer running.
while [ "$(curl -s "${AUTH[@]}" "$VIGIL/api/runs/$RUN" | jq -r .data.run.status)" = running ]; do sleep 2; done

# The status and the answer.
curl -s "${AUTH[@]}" "$VIGIL/api/runs/$RUN" | jq '.data.run | {status, tokensUsed, error}'
curl -s "${AUTH[@]}" "$VIGIL/api/runs/$RUN/result" | jq -r .data.text
```

Leave out `-d` to use the agent's own default task. A run ends as `succeeded`, `failed`, `budget-exceeded`, `step-limit` or `waiting-approval`. The last one is a pause, not an end: see the next part.

If the agent is busy you get `409 agent-busy`. If a token limit is reached you get `429` with the code `monthly-cap-reached` or `agent-daily-cap-reached`.

## Approve or reject what an agent wants to do

```sh
# What waits (writes, and web or agent calls when the agent asks first).
curl -s "${AUTH[@]}" "$VIGIL/api/approvals" | jq '.data[] | {id, agent, tool, title, target}'

# Decide. When the last waiting call of a run is decided, the run goes on.
curl -s "${AUTH[@]}" -X POST "$VIGIL/api/approvals/$APPROVAL_ID/decision" \
  -H 'content-type: application/json' -d '{"decision":"approve"}'
```

Use `"reject"` to refuse. If the note changed after the agent proposed its write, an approval answers `409 approval-stale`. Read the note, then send `{"decision":"approve","force":true}` to apply it anyway.

## Cancel or undo a run

```sh
curl -s "${AUTH[@]}" -X POST "$VIGIL/api/runs/$RUN/cancel"   # a run that is still going (409 run-not-active otherwise)
curl -s "${AUTH[@]}" -X POST "$VIGIL/api/runs/$RUN/undo"     # restore the notes the run changed
```

## Notes

```sh
curl -s "${AUTH[@]}" "$VIGIL/api/search?q=enthalpy" | jq .
curl -s "${AUTH[@]}" "$VIGIL/api/notes/enthalpy" | jq -r .data.body
```

## Be told instead of polling: the webhook

Set `VIGIL_WEBHOOK_URL` (an `http` or `https` address, for example a chat or ntfy address) and Vigil sends one JSON `POST` when a run waits for approval, when a run did not finish, and when a scheduled (cron or heartbeat) run finished. The body names the run and never holds note text:

```json
{
  "event": "approval",
  "text": "Vigil: agent morning-digest is waiting for your approval",
  "run": { "id": "…", "agent": "morning-digest", "status": "waiting-approval", "trigger": "cron", "tokensUsed": 812, "error": null }
}
```

`event` is `approval`, `failed` or `finished`. Chat turns, child runs, cancelled runs and manual runs that worked send nothing. Sending is best effort with a 5-second limit: a broken webhook never changes a run. Treat the address as a secret: it is not written to the log.

## Save a run as JSON Lines

```
curl -s "${AUTH[@]}" "$VIGIL/api/runs/$RUN/trace" > run.jsonl
```

The first line is the run (`"type": "run"`, with `config`, the setup fingerprint). Each log entry follows as an `"type": "event"` line. Child runs started with `call_agent` come after, each with its own run line and events.

## Turn a run into an eval case

```sh
curl -s "${AUTH[@]}" "$VIGIL/api/runs/$RUN/eval-case" > ~/vigil-cases/my-case.json
# Edit the file: check "expect", add "answer" (a regular expression) if the answer matters.
pnpm --filter @vigil/server eval --agent --cases ~/vigil-cases
```
