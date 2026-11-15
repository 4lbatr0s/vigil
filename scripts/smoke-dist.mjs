// Starts the bundled server against a temp data directory and checks /api/health, then stops it.
// Usage: node scripts/smoke-dist.mjs   (after `pnpm --filter @vigil/server build`)
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tmp = mkdtempSync(path.join(tmpdir(), "vigil-smoke-"));
const port = 3000 + Math.floor(Math.random() * 1000) + 100;
const child = spawn(process.execPath, [path.join(root, "apps", "server", "dist", "server.mjs")], {
  env: {
    ...process.env,
    PORT: String(port),
    HOST: "127.0.0.1",
    VAULT_DIR: path.join(tmp, "vault"),
    DB_PATH: path.join(tmp, "index.db"),
    STATE_DB_PATH: path.join(tmp, "state.db"),
    CHECKPOINT_DB_PATH: path.join(tmp, "checkpoints.db"),
    SESSION_KEY_PATH: path.join(tmp, "session.key"),
  },
  stdio: ["ignore", "inherit", "inherit"],
});

let ok = false;
for (let i = 0; i < 60 && !ok; i++) {
  await new Promise((r) => setTimeout(r, 250));
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/health`);
    ok = res.ok && (await res.json()).data?.ok === true;
  } catch {
    // not up yet
  }
}
child.kill("SIGTERM");
await new Promise((r) => child.once("exit", r));
rmSync(tmp, { recursive: true, force: true });
if (!ok) {
  console.error("smoke: the bundled server did not answer /api/health");
  process.exit(1);
}
console.log("smoke: the bundled server answered /api/health");
