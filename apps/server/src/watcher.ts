import chokidar, { type FSWatcher } from "chokidar";
import path from "node:path";
import { removeNote, reindexNote } from "./index-db";
import { getNote, vaultDir } from "./vault";

const DEBOUNCE_MS = 300;

/**
 * Watches the vault dir and reconciles files into the SQLite index.
 * Markdown files stay the source of truth; the index is derived (ADR-0001).
 */
export function startWatcher(): { close(): Promise<void> } {
  const timers = new Map<string, NodeJS.Timeout>();
  const watcher: FSWatcher = chokidar.watch(vaultDir(), {
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 100, pollInterval: 20 },
  });

  const schedule = (filePath: string, run: () => Promise<void>): void => {
    const existing = timers.get(filePath);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      timers.delete(filePath);
      void run().catch((err: unknown) => {
        // A failure must not kill the watcher; the next event retries. Say what failed.
        const reason = err instanceof Error ? err.message : String(err);
        console.error(`vigil-server could not reconcile ${path.basename(filePath)}: ${reason}`);
      });
    }, DEBOUNCE_MS);
    timers.set(filePath, timer);
  };

  const idOf = (filePath: string): string | null => {
    const base = path.basename(filePath);
    if (!base.endsWith(".md")) return null;
    return base.slice(0, -3);
  };

  watcher.on("add", (filePath) => {
    const id = idOf(filePath);
    if (!id) return;
    schedule(filePath, async () => {
      const note = await getNote(id);
      reindexNote(note);
    });
  });

  watcher.on("change", (filePath) => {
    const id = idOf(filePath);
    if (!id) return;
    schedule(filePath, async () => {
      const note = await getNote(id);
      reindexNote(note);
    });
  });

  watcher.on("unlink", (filePath) => {
    const id = idOf(filePath);
    if (!id) return;
    schedule(filePath, async () => {
      removeNote(id);
    });
  });

  return {
    close: async () => {
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
      await watcher.close();
    },
  };
}
