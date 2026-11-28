import type { Run, RunStatus } from "@vigil/shared";

/** "15 Nov 07:00" in the viewer's own time zone; empty text for a missing time. */
export function formatStamp(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return "never";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "never";
  const time = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  const sameYear = d.getFullYear() === now.getFullYear();
  const day = d.toLocaleDateString("en-GB", { day: "numeric", month: "short", ...(sameYear ? {} : { year: "numeric" }) });
  return `${day} ${time}`;
}

/** "just now", "4 min ago", "3 h ago", "2 days ago". */
export function agoText(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return "never";
  const ms = now.getTime() - Date.parse(iso);
  if (Number.isNaN(ms)) return "never";
  const min = Math.floor(Math.max(0, ms) / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.floor(h / 24)} days ago`;
}

const RUN_STATUS_TEXT: Record<RunStatus, string> = {
  running: "Running",
  succeeded: "Finished",
  failed: "Failed",
  "budget-exceeded": "Stopped at its token limit",
  "step-limit": "Stopped at its step limit",
  interrupted: "Interrupted",
  "waiting-approval": "Waiting for you",
  skipped: "Skipped",
};

/** A run's status in plain words, never the raw enum. */
export const runStatusText = (status: RunStatus): string => RUN_STATUS_TEXT[status];

const RUN_TRIGGER_TEXT: Record<Run["trigger"], string> = {
  manual: "You started it",
  cron: "Its schedule",
  heartbeat: "A note changed",
  chat: "A chat",
  call: "Another helper",
  mcp: "An outside tool (MCP)",
};

/** What started a run, in plain words. */
export const runTriggerText = (trigger: Run["trigger"]): string => RUN_TRIGGER_TEXT[trigger];

/** The heartbeat line on the agent page, e.g. "Checked 4 min ago, unchanged". */
export function describeCheck(lastCheckedAt: string | null, skipReason: string | null, now: Date = new Date()): string {
  if (!lastCheckedAt) return "Not checked yet";
  const tail = skipReason ? `, ${skipReason}` : "";
  return `Checked ${agoText(lastCheckedAt, now)}${tail}`;
}
