import type { Run } from "@vigil/shared";
import { writable } from "svelte/store";
import { listRuns } from "./api";
import { liveEvents } from "./live";

const KEY = "vigil.lastVisit";
const DAY_MS = 24 * 3_600_000;

/** When the owner last marked the Today view as seen; null the first time. */
export function lastVisit(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function markSeen(now: Date = new Date()): void {
  try {
    localStorage.setItem(KEY, now.toISOString());
  } catch {
    // Without storage everything counts as new each time.
  }
}

/**
 * Runs worth showing since `since` (the last visit, or the last 24 hours the first time): started after it,
 * newest first. Runs a person started in chat are left out (they watched those); a run still going is news too.
 */
export function sinceVisit(runs: readonly Run[], since: string | null, now: Date = new Date()): Run[] {
  const from = since ?? new Date(now.getTime() - DAY_MS).toISOString();
  return runs.filter((r) => r.trigger !== "chat" && r.startedAt > from).sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

/** The nav badge: how many runs happened since the last visit. */
export const unseenCount = writable(0);

export async function refreshUnseen(): Promise<void> {
  try {
    unseenCount.set(sinceVisit(await listRuns({ limit: 100 }), lastVisit()).length);
  } catch {
    // Keep the last count; the next event tries again.
  }
}

let started = false;
/** Loads the count once and refreshes it when a run changes. Called by the shell. */
export function trackUnseen(): () => void {
  if (started) return () => undefined;
  started = true;
  void refreshUnseen();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const unsub = liveEvents.subscribe((e) => {
    if (e?.type !== "run") return;
    clearTimeout(timer);
    timer = setTimeout(() => void refreshUnseen(), 500);
  });
  return () => {
    clearTimeout(timer);
    unsub();
    started = false;
  };
}

/** How many things wait in the Inbox note: each non-empty body line once (frontmatter left out). */
export function inboxItems(body: string): number {
  const text = body.startsWith("---\n") ? body.slice(body.indexOf("\n---", 4) + 4) : body;
  return text.split("\n").filter((l) => l.trim() !== "").length;
}

/** The day in plain words for the top of Today: "Thursday, 26 November". */
export function dateLine(now: Date = new Date()): string {
  return now.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" }).replace(/^(\w+) /, "$1, ");
}

export type FirstStep = { key: "write" | "card" | "link"; done: boolean };

/**
 * The first-run steps on Today (2026-11-26), learned by doing: write a note, make a card, link two notes. Each ticks
 * itself off from what is in the vault; the block goes away when all three are done or the learner hides it.
 */
export function firstSteps(input: { notes: readonly { id: string }[]; cards: number; linked: boolean }): FirstStep[] {
  return [
    { key: "write", done: input.notes.some((n) => n.id !== "inbox") },
    { key: "card", done: input.cards > 0 },
    { key: "link", done: input.linked },
  ];
}

const STEPS_HIDDEN = "vigil.firstSteps.hidden";

export function firstStepsHidden(): boolean {
  try {
    return localStorage.getItem(STEPS_HIDDEN) === "1";
  } catch {
    return false; // storage blocked: the steps show, which is the safe default
  }
}

export function hideFirstSteps(): void {
  try {
    localStorage.setItem(STEPS_HIDDEN, "1");
  } catch {
    // A blocked store only means the steps come back on the next visit.
  }
}
