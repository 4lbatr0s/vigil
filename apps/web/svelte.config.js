import adapter from "@sveltejs/adapter-static";
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";

/** @type {import('@sveltejs/kit').Config} */
const config = {
  preprocess: vitePreprocess(),
  kit: {
    // A static single-page app served by the API server (ADR-0014): one process, one origin.
    adapter: adapter({ fallback: "index.html" }),
    // The bootstrap script SvelteKit inlines is allowed by hash, so script-src never needs 'unsafe-inline'.
    csp: {
      mode: "hash",
      directives: {
        "default-src": ["self"],
        "img-src": ["self", "data:"],
        "style-src": ["self", "unsafe-inline"],
        "script-src": ["self"],
        "connect-src": ["self"],
        "frame-ancestors": ["none"],
        "base-uri": ["none"],
        "form-action": ["self"],
      },
    },
  },
};

export default config;
