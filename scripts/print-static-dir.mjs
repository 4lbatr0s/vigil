// Prints where the built web app is, for VIGIL_STATIC_DIR.
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "apps", "web", "build");
console.log(`\nWeb app built. Serve it with the API server:\n  VIGIL_STATIC_DIR=${dir}`);
