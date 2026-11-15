import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

// WP0-T4: every test file runs against a throwaway directory. The env accessors
// (vaultDir, dbPath, statePath) are read per call, so setting the vars here before
// any test file loads keeps the real vault/ and data/ untouchable. Individual tests
// may still override with their own mkdtemp dirs (existing tests do).
const dir = mkdtempSync(path.join(os.tmpdir(), "vigil-test-"));

process.env.VAULT_DIR = path.join(dir, "vault");
process.env.DB_PATH = path.join(dir, "index.db");
process.env.STATE_DB_PATH = path.join(dir, "state.db");
process.env.CHECKPOINT_DB_PATH = path.join(dir, "checkpoints.db");
process.env.SESSION_KEY_PATH = path.join(dir, "session.key");

process.on("exit", () => {
  rmSync(dir, { recursive: true, force: true });
});
