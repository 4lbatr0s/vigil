import { getPermissions } from "./permissions";
import { expireSnapshots, pruneEvents } from "./state-db";

const DAY_MS = 24 * 3_600_000;

/**
 * Drop old run logs and undo snapshots. `retentionDays` 0 keeps everything. Run rows are never
 * deleted, and runs that are running or waiting for approval are never touched.
 */
export async function prune(now: Date, retentionDays: number = getPermissions().retentionDays): Promise<{ events: number; snapshots: number }> {
  if (retentionDays <= 0) return { events: 0, snapshots: 0 };
  const before = new Date(now.getTime() - retentionDays * DAY_MS).toISOString();
  return { events: pruneEvents(before), snapshots: await expireSnapshots(before) };
}

/** Prune once now, then every 24 hours. The timer never keeps the process alive. */
export function startHousekeeping(now: () => Date = () => new Date()): { stop(): void } {
  const run = (): void => {
    prune(now()).catch((err: unknown) => {
      console.error("vigil-server housekeeping failed:", err instanceof Error ? err.message : err);
    });
  };
  run();
  const timer = setInterval(run, DAY_MS);
  timer.unref();
  return { stop: () => clearInterval(timer) };
}
