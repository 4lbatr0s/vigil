import type { Goal } from "./api";

/** The soonest exam that has not passed, or null. */
export function nextGoal(goals: readonly Goal[]): Goal | null {
  return goals.filter((g) => g.daysLeft >= 0).sort((a, b) => a.daysLeft - b.daysLeft)[0] ?? null;
}

export function daysLeftText(left: number): string {
  if (left < 0) return "has passed";
  if (left === 0) return "is today";
  if (left === 1) return "is tomorrow";
  return `is in ${left} days`;
}

/** One calm sentence about where an exam stands. No countdown pressure, just what to do. */
export function goalLine(g: Goal): string {
  const what = g.kind === "tag" ? `#${g.value}` : g.value;
  if (g.daysLeft < 0) return `${what}: your exam date has passed. You can remove it.`;
  if (g.cards === 0) return `${what}: no cards yet. Make some so there is something to practise.`;
  const left = `${g.toStudy} ${g.toStudy === 1 ? "card" : "cards"} to go`;
  const pace = g.onTrack ? "You are on pace." : "That is a lot for the time left; do a few more new cards each day.";
  return `${what} ${daysLeftText(g.daysLeft)}. ${left}. ${pace}`;
}
