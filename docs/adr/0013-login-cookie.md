# ADR-0013: Browser login with a signed HttpOnly cookie (follows ADR-0007)

## Status
Proposed (2026-11-15). Becomes Accepted when WP12 starts.

## Context
ADR-0007 requires `VIGIL_TOKEN` for any non-local bind and accepts it as a bearer token. A browser UI cannot keep a bearer token safely (it would live in page script). Hosted installs need a login that survives page loads without exposing the token to scripts.

## Decision
- Local mode (no `VIGIL_TOKEN`): no login at all.
- With a token: `POST /api/login` `{ token }`. Compare with `sameToken` (constant time). On success set `vigil_session=<payload>.<signature>`; payload is base64url of `{"exp": <unix seconds>}`; signature is HMAC-SHA256 over the payload with a 32-byte random key stored at `data/session.key` (created on first start, mode 0600, never logged). Attributes: `HttpOnly; SameSite=Strict; Path=/; Max-Age=2592000`, plus `Secure` when the request is HTTPS or `VIGIL_COOKIE_SECURE=1`. `x-forwarded-proto` counts only when the Host is in `VIGIL_ALLOWED_HOSTS`.
- `checkAccess` accepts the bearer header or a valid, unexpired cookie. `POST /api/logout` clears the cookie. `/api/health` stays open.
- **Brute force:** in-memory per-IP counter, 5 failures within 60 seconds then `429 too-many-attempts` until the window ends. Behind a proxy, honor `x-forwarded-for` only when the Host is in `VIGIL_ALLOWED_HOSTS` and take the right-most non-private entry.
- **CSRF:** `SameSite=Strict` plus the existing rule that a present Origin must equal Host.
- The web client turns a `401` into a redirect to `/login?next=<same-origin path>`.

## Consequences
- Rotating `data/session.key` logs everyone out; changing `VIGIL_TOKEN` does not invalidate existing cookies until expiry (document; delete the key to force it).
- One shared secret, one user: consistent with v1 scope.
- The rate limit is per process memory and resets on restart; acceptable for a single-user instance.
