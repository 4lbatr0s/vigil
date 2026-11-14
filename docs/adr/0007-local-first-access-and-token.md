# ADR-0007: Local-first access, no CORS, token for anything else

## Status
Accepted (2026-11-14)

## Context
The first server build listened on every network interface, sent `access-control-allow-origin: *` and had no login. Any device on the same network, and any website the owner visits (through the wildcard CORS header), could read and write notes. Once agents run, the same API starts runs and spends the owner's API key.

## Decision
- **Bind to 127.0.0.1 by default** (`HOST`). Listening on any other address needs `VIGIL_TOKEN`; the server refuses to start otherwise.
- **No CORS.** The browser UI is same-origin: the web app and `/api` share one origin (dev proxy now, one process in the Docker image later). Preflight requests get 404.
- **Host check.** A request whose Host header is not localhost, 127.0.0.1, [::1] or listed in `VIGIL_ALLOWED_HOSTS` gets 403. This blocks DNS rebinding.
- **Origin check.** A request with an Origin header that differs from its Host gets 403.
- **Token.** When `VIGIL_TOKEN` is set, every `/api` call except `/api/health` needs `Authorization: Bearer <token>`, compared in constant time. One token, one owner: the v1 single-user rule (ADR-0002) stays.
- The dev proxy attaches the token from its own environment; page code never sees it.

## Consequences
- Local use needs no setup. Exposing Vigil (LAN, reverse proxy, cloud) is an explicit act: set `HOST`, `VIGIL_TOKEN`, `VIGIL_ALLOWED_HOSTS`, and use TLS at the proxy.
- A browser UI for a hosted install needs a login screen that holds the token in an HttpOnly cookie. That arrives with the Docker milestone (see the roadmap); until then a non-local install is for API and proxy use.
- The token is a shared secret in the process environment, never in the vault or the repo.
