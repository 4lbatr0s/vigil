import { writable } from "svelte/store";
import { getStudyStats } from "./api";
import { NEW_PER_SESSION } from "./study-const";

/** Cards waiting now (due reviews plus the day's new ones); drives the navigation badge. */
export const studyDue = writable(0);

export async function refreshStudyDue(): Promise<void> {
  try {
    const s = await getStudyStats();
    studyDue.set(s.due + Math.min(s.new, NEW_PER_SESSION));
  } catch {
    // Keep the last count; the next visit tries again.
  }
}
