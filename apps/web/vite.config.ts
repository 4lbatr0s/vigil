import { sveltekit } from "@sveltejs/kit/vite";
import { defineConfig } from "vite";

// The browser only ever talks to this dev server; the proxy adds the server token (ADR-0007) so it
// never reaches page code.
const token = process.env.VIGIL_TOKEN;

export default defineConfig({
  plugins: [sveltekit()],
  server: {
    proxy: {
      "/api": {
        target: "http://127.0.0.1:3001",
        headers: token ? { authorization: `Bearer ${token}` } : {},
      },
    },
  },
});
