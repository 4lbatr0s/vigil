import { writable } from "svelte/store";
import { listApprovals } from "./api";
import { liveEvents } from "./live";

/** Pending approvals waiting for the owner; drives the rail badge. */
export const pendingCount = writable(0);

export async function refreshPending(): Promise<void> {
  try {
    pendingCount.set((await listApprovals("pending")).length);
  } catch {
    // Keep the last count; the next event or visit tries again.
  }
}

let started = false;
/** Loads the count once and keeps it current from the live stream. Called by the shell. */
export function trackPending(): () => void {
  if (started) return () => undefined;
  started = true;
  void refreshPending();
  const unsub = liveEvents.subscribe((e) => {
    if (e?.type === "approval") pendingCount.set(e.count);
  });
  return () => {
    unsub();
    started = false;
  };
}
