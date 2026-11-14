# ADR-0014: The web app is a static SPA served by the API server

## Status
Proposed (2026-11-15). Becomes Accepted when WP12 starts.

## Context
v1 ships as one Docker image with one volume (decision 13). SvelteKit can run its own Node server (SSR) or build a static single-page app. Vigil's pages are private and interactive; nothing needs SSR or SEO. ADR-0007 wants the UI and API on one origin (no CORS). The markdown preview uses DOMPurify, which needs a real DOM.

## Decision
- Build the web app with `@sveltejs/adapter-static` (`fallback: "index.html"`), with `export const ssr = false; export const prerender = false;` in the root `+layout.ts`. Pin the adapter to a version compatible with the installed SvelteKit.
- The API server serves the build when `VIGIL_STATIC_DIR` is set: `GET`/`HEAD` outside `/api/` resolve a file under the directory (path-traversal guard; encoded and double-dot forms rejected), unknown extension-less paths fall back to `index.html`, unknown paths with an extension return 404. Hashed assets under `/_app/immutable/` get `Cache-Control: public, max-age=31536000, immutable`; everything else `no-cache`.
- Security headers on every static response: CSP (`default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'`; if SvelteKit needs an inline bootstrap script use `kit.csp` hash mode rather than `'unsafe-inline'` for scripts), `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`.
- The Host check applies to static requests; token and cookie do not (the shell holds no data).
- In development the Vite dev server keeps proxying `/api`.
- **Container runtime:** the server is bundled with esbuild (`apps/server/dist/server.mjs`, `@vigil/shared` inlined, every other dependency external, native modules installed in the image) and started with plain `node`. Reason: cold start and image size matter (owner's guiding rule: performance and usability balance). If bundling a package fails because of dynamic requires, mark that package external; do not fall back to `tsx`. A smoke check starts the bundle against a temp directory in CI.

## Consequences
- One process, one port, one origin; no CORS ever.
- No server-side rendering: first paint waits for JavaScript. Acceptable for a private app.
- The service worker (PWA) precaches the shell and never caches `/api/`.
- Heavy views (graph, diff, editor language data) load lazily; the initial JavaScript for `/` has a budget (180 KB gzip) enforced in CI.
