import { defineConfig } from "vitest/config";

// jsdom, not happy-dom: DOMPurify needs a spec-complete DOM, and happy-dom both stripped every tag
// and ran inline scripts. jsdom does not run scripts unless asked to.
export default defineConfig({ test: { environment: "jsdom" } });
