import type { Agent, Run } from "@vigil/shared";
import { cronError, latestTickAtOrBefore } from "./cron";
import { diffHashes, heartbeatTask, isEmptyDiff, visibleHashes } from "./heartbeat";
import { getAgent, getHeartbeat, getSchedule, putHeartbeat, putSchedule, touchHeartbeat } from "./state-db";

export type SchedulerDeps = {
  now: () => Date;
  listAgents: () => Agent[];
  startRun: (name: string, task: string | undefined, trigger: "cron" | "heartbeat") => Run;
  hasRunning: (name: string) => boolean;
  catchUpWindowMs: number;
};

export type Scheduler = {
  tick(): void;
  /** First-sight step for one agent, so a freshly saved agent has its baseline before the next tick. */
  refresh(name: string): void;
  start(intervalMs?: number): void;
  stop(): void;
};

let active: Scheduler | null = null;

/** Baseline for an agent that was just saved. No-op while no scheduler is running (tests, scripts). */
export function refreshSchedule(name: string): void {
  active?.refresh(name);
}

export function createScheduler(deps: SchedulerDeps): Scheduler {
  let timer: NodeJS.Timeout | null = null;

  /** One heartbeat check. `fire` false stores the baseline only (refresh). */
  function beat(agent: Agent, everyMinutes: number, fire: boolean): void {
    const now = deps.now();
    const state = getHeartbeat(agent.name);
    if (state?.lastCheckedAt && fire && now.getTime() - Date.parse(state.lastCheckedAt) < everyMinutes * 60_000) return;
    const next = visibleHashes(agent.name);
    if (!state || !state.lastHashes) {
      // First sight: remember what is there now. Saving an agent must not make it react to old notes.
      putHeartbeat(agent.name, { lastCheckedAt: now.toISOString(), lastHashes: next });
      return;
    }
    if (!fire) return;
    const diff = diffHashes(state.lastHashes, next);
    if (isEmptyDiff(diff)) {
      touchHeartbeat(agent.name, now.toISOString());
      putSchedule(agent.name, { lastSkipReason: "unchanged" });
      return;
    }
    if (deps.hasRunning(agent.name)) {
      // The change stays pending: last_hashes is not advanced, only the check time.
      touchHeartbeat(agent.name, now.toISOString());
      putSchedule(agent.name, { lastSkipReason: "previous run still going" });
      return;
    }
    // Persist before starting (at most once per change), as for cron.
    putHeartbeat(agent.name, { lastCheckedAt: now.toISOString(), lastHashes: next });
    try {
      deps.startRun(agent.name, heartbeatTask(diff), "heartbeat");
      putSchedule(agent.name, { lastStartedAt: now.toISOString(), lastSkipReason: null });
    } catch (err) {
      putSchedule(agent.name, { lastSkipReason: `start failed: ${err instanceof Error ? err.message : "unknown error"}` });
    }
  }

  /** `fire` false stores the baseline only (refresh). */
  function visit(agent: Agent, fire: boolean): void {
    if (!agent.enabled) return;
    if (agent.trigger.kind === "heartbeat") {
      beat(agent, agent.trigger.everyMinutes, fire);
      return;
    }
    if (agent.trigger.kind !== "cron") return;
    const { expression, timezone } = agent.trigger;
    const state = getSchedule(agent.name);
    if (cronError(expression, timezone)) {
      putSchedule(agent.name, { lastSkipReason: "bad cron expression" });
      return;
    }
    const now = deps.now();
    const prev = latestTickAtOrBefore(expression, timezone, now);
    if (!prev) return;
    const prevIso = prev.toISOString();
    const last = state?.lastScheduledFor ?? null;
    if (last === null) {
      putSchedule(agent.name, { lastScheduledFor: prevIso });
      return;
    }
    if (!fire || prevIso <= last) return;
    if (now.getTime() - prev.getTime() > deps.catchUpWindowMs) {
      putSchedule(agent.name, { lastScheduledFor: prevIso, lastSkipReason: "missed, older than catch-up window" });
      return;
    }
    // Persist before starting: at most once per scheduled time, even if the process dies next.
    putSchedule(agent.name, { lastScheduledFor: prevIso });
    if (deps.hasRunning(agent.name)) {
      putSchedule(agent.name, { lastSkipReason: "previous run still going" });
      return;
    }
    try {
      deps.startRun(agent.name, undefined, "cron");
      putSchedule(agent.name, { lastStartedAt: now.toISOString(), lastSkipReason: null });
    } catch (err) {
      putSchedule(agent.name, { lastSkipReason: `start failed: ${err instanceof Error ? err.message : "unknown error"}` });
    }
  }

  function tick(): void {
    for (const agent of deps.listAgents()) {
      try {
        visit(agent, true);
      } catch (err) {
        // One agent's problem must not stop the others.
        console.error(`vigil-server scheduler error for ${agent.name}:`, err instanceof Error ? err.message : err);
      }
    }
  }

  const scheduler: Scheduler = {
    tick,
    refresh(name) {
      const agent = deps.listAgents().find((a) => a.name === name) ?? getAgent(name);
      if (agent) visit(agent, false);
    },
    start(intervalMs = 15_000) {
      if (timer) return;
      tick(); // on-start catch-up
      timer = setInterval(tick, intervalMs);
      timer.unref();
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
      if (active === scheduler) active = null;
    },
  };
  active = scheduler;
  return scheduler;
}
