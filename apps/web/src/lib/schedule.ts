import type { Agent, Run } from "@vigil/shared";

const DAYS = ["Sundays", "Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays"];

const pad = (n: string): string => n.padStart(2, "0");

/** A short, human reading of a trigger ("daily 07:00"); falls back to the raw cron expression. */
export function describeTrigger(trigger: Agent["trigger"]): string {
  if (trigger.kind === "manual") return "when you start it";
  if (trigger.kind === "heartbeat") return `every ${trigger.everyMinutes} min if notes changed`;
  const raw = trigger.expression.trim();
  const f = raw.split(/\s+/);
  if (f.length !== 5) return raw;
  const [min, hour, dom, mon, dow] = f as [string, string, string, string, string];
  const digits = /^\d+$/;
  if (raw === "* * * * *") return "every minute";
  const step = /^\*\/(\d+)$/.exec(min);
  if (step && hour === "*" && dom === "*" && mon === "*" && dow === "*") return `every ${step[1]} min`;
  if (digits.test(min) && digits.test(hour) && dom === "*" && mon === "*") {
    const time = `${pad(hour)}:${pad(min)}`;
    if (dow === "*") return `daily ${time}`;
    if (digits.test(dow) && Number(dow) <= 7) return `${DAYS[Number(dow) % 7]} ${time}`;
  }
  return raw;
}

/** "Runs daily at 07:00" style sentence for the Turn on panel. */
export function describeTriggerSentence(trigger: Agent["trigger"]): string {
  if (trigger.kind === "manual") return "Runs only when you start it.";
  if (trigger.kind === "heartbeat") return `Checks every ${trigger.everyMinutes} minutes and runs only if your notes changed.`;
  const short = describeTrigger(trigger);
  if (short.startsWith("daily ")) return `Runs daily at ${short.slice(6)}.`;
  if (short.startsWith("every ")) return `Runs ${short}.`;
  const day = DAYS.find((d) => short.startsWith(d));
  if (day) return `Runs on ${day} at ${short.slice(day.length + 1)}.`;
  return `Runs on schedule ${short}.`;
}

export type Dot = "running" | "ok" | "err" | "idle";

/** Status dot for a ledger row: amber while running, green or red by the last finished run, muted otherwise. */
export function statusDot(agent: Pick<Agent, "enabled">, lastRun: Pick<Run, "status"> | undefined): Dot {
  if (lastRun?.status === "running") return "running";
  if (!lastRun) return "idle";
  if (lastRun.status === "succeeded") return agent.enabled ? "ok" : "idle";
  if (lastRun.status === "failed" || lastRun.status === "budget-exceeded" || lastRun.status === "step-limit") return "err";
  return "idle";
}

/** The newest run per agent. Runs arrive newest first, so the first one seen wins. */
export function lastRunByAgent(runs: Run[]): Map<string, Run> {
  const map = new Map<string, Run>();
  for (const run of runs) if (!map.has(run.agent)) map.set(run.agent, run);
  return map;
}
