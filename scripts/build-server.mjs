// Bundles the API server into apps/server/dist/server.mjs so production runs with plain `node` (ADR-0014).
// Every dependency in apps/server/package.json stays external (installed in the image, native modules
// included) except @vigil/shared, a TypeScript workspace package that is inlined.
import { build } from "esbuild";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const server = path.join(root, "apps", "server");
const pkg = JSON.parse(readFileSync(path.join(server, "package.json"), "utf8"));
const external = Object.keys(pkg.dependencies ?? {}).filter((name) => name !== "@vigil/shared");

await build({
  entryPoints: [path.join(server, "src", "index.ts")],
  outfile: path.join(server, "dist", "server.mjs"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  sourcemap: true,
  external,
  // CommonJS packages that are inlined (none today) would need require(); give them one.
  banner: { js: 'import { createRequire as __vigilCreateRequire } from "node:module"; const require = __vigilCreateRequire(import.meta.url);' },
  logLevel: "info",
});
