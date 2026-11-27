# ADR-0036: Cloudflare Access counts as a login

## Status
Accepted (2026-11-28, chosen by the owner). It amends ADR-0007: a request that carries a valid Cloudflare Access JWT needs no `VIGIL_TOKEN`. Every other rule of ADR-0007 stays: loopback bind by default, Host and Origin checks, `VIGIL_TOKEN` still required for a non-loopback bind.

## Context
The owner runs Vigil at `vigil.mountain42.dev` behind Cloudflare Access (e-mail one-time PIN, one allow policy). Access already proves who the owner is. Typing `VIGIL_TOKEN` after the Access login is a second login with no extra value for one user.

## Decision
1. Two new variables: `VIGIL_ACCESS_TEAM_DOMAIN` (`<team>.cloudflareaccess.com`) and `VIGIL_ACCESS_AUD` (the Access application's AUD tag). Both or neither; half a configuration stops the server at start.
2. For each request the server reads `Cf-Access-Jwt-Assertion` and verifies it: RS256 only, signature against `https://<team>/cdn-cgi/access/certs` (cached 10 minutes, refreshed once for an unknown `kid`), `iss` equal to the team URL, `aud` containing the AUD tag, `exp` and `nbf` with 60 s skew.
3. A verified request skips the token check and `/api/session` reports it as signed in. The Host and Origin checks still run first.
4. The bearer token and the token login stay. They are the way in over the SSH tunnel and for MCP clients.

## Consequences
- The header alone grants nothing: without a valid signature for this AUD the request falls back to the token check.
- If Cloudflare's key endpoint is down and no keys are cached, Access logins fail closed (the token login still works).
- Sign out in Vigil clears only Vigil's own cookie. While the Access session lasts (24 h by policy) the browser stays signed in. End it at `https://<team>/cdn-cgi/access/logout`.
