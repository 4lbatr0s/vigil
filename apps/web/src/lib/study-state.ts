import { writable } from "svelte/store";
import { getStudyStats } from "./api";

/** Cards waiting now (due reviews plus the day's new ones); drives the navigation badge. */
export const studyDue = writable(0);

export async function refreshStudyDue(): Promise<void> {
  try {
    const s = await getStudyStats();
    studyDue.set(s.due + s.newOffered);
  } catch {
    // Keep the last count; the next visit tries again.
  }
}
