import { sveltekit } from "@sveltejs/kit/vite";
import { defineConfig } from "vite";

// The browser only ever talks to this dev server; the proxy adds the server token (ADR-0007) so it
// never reaches page code.
const token = process.env.VIGIL_TOKEN;
// Lets a second dev server (for example one on a throwaway vault) run beside the usual one.
const apiTarget = process.env.VIGIL_API_URL ?? "http://127.0.0.1:3001";

export default defineConfig({
  plugins: [sveltekit()],
  server: {
    proxy: {
      "/api": {
        target: apiTarget,
        headers: token ? { authorization: `Bearer ${token}` } : {},
      },
    },
  },
});
