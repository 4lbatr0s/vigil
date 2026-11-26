import type { Goal, RecallItem, StuckCard } from "./api";
import { daysLeftText } from "./goals";
import { noteHref } from "./links";

export type Focus = { key: string; text: string; href: string; label: string };

type Input = {
  goals: readonly Goal[];
  recallDue: readonly RecallItem[];
  studyDue: number;
  newOffered: number;
  stuck: readonly StuckCard[];
  pendingApprovals: number;
  /** Notes you wrote lately that have no study cards yet, newest first. */
  uncarded?: readonly { id: string; title: string }[];
  titles: ReadonlyMap<string, string>;
};

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/**
 * What to do first today, most pressing first, at most three, in plain words. An exam within a week with cards left
 * comes before everything; then writing agents waiting for your yes (a person is blocking them), recall checks that are
 * due, the cards, and last the cards that keep slipping. Nothing here is a score or a streak.
 */
export function startHere(i: Input): Focus[] {
  const out: Focus[] = [];
  const soon = i.goals.filter((g) => g.daysLeft >= 0 && g.daysLeft <= 7 && g.toStudy > 0).sort((a, b) => a.daysLeft - b.daysLeft)[0];
  if (soon) {
    const what = soon.kind === "tag" ? `#${soon.value}` : (i.titles.get(soon.value) ?? soon.value);
    out.push({ key: "exam", text: `${what} ${daysLeftText(soon.daysLeft)} and ${plural(soon.toStudy, "card is", "cards are")} still to study.`, href: soon.kind === "note" ? `/study?note=${encodeURIComponent(soon.value)}` : "/study", label: "Study for it" });
  }
  if (i.pendingApprovals > 0) out.push({ key: "approvals", text: `${plural(i.pendingApprovals, "change is", "changes are")} waiting for your yes.`, href: "/approvals", label: "Review" });
  const recall = i.recallDue[0];
  if (recall) out.push({ key: "recall", text: `A recall check is due: ${i.titles.get(recall.noteId) ?? recall.noteId}${i.recallDue.length > 1 ? ` and ${i.recallDue.length - 1} more` : ""}.`, href: `/recall?note=${encodeURIComponent(recall.noteId)}`, label: "Recall" });
  const cards = i.studyDue + i.newOffered;
  if (cards > 0 && !out.some((f) => f.key === "exam")) out.push({ key: "cards", text: `${plural(cards, "card is", "cards are")} ready to review.`, href: "/study", label: "Study" });
  if (i.stuck.length > 0) out.push({ key: "stuck", text: `${plural(i.stuck.length, "card keeps", "cards keep")} slipping: reword or split ${i.stuck.length === 1 ? "it" : "them"}.`, href: "/study", label: "See them" });
  const fresh = i.uncarded?.[0];
  if (fresh) out.push({ key: "uncarded", text: `You wrote "${fresh.title}" recently and it has no study cards yet.`, href: noteHref(fresh.id), label: "Make cards" });
  return out.slice(0, 3);
}
