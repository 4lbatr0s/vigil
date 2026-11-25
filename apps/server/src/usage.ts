import { AppError } from "./errors";
import { agentTokensSince, tokensSince } from "./state-db";

export type UsageLevel = "ok" | "warn" | "over";
export type Usage = { month: string; tokens: number; cap: number | null; level: UsageLevel };

/** Tokens used by runs started this calendar month (UTC). */
export function monthTokens(now: Date): number {
  return tokensSince(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString());
}

/** The soft cap from VIGIL_MONTHLY_TOKEN_CAP; unset, empty or not a positive number means no cap. */
export function monthlyCap(env: NodeJS.ProcessEnv = process.env): number | null {
  const raw = env.VIGIL_MONTHLY_TOKEN_CAP;
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
}

/**
 * The cap is soft (ADR-0003): it only drives this level for the UI banner. It never blocks a run.
 */
export function usage(now: Date = new Date(), env: NodeJS.ProcessEnv = process.env): Usage {
  const tokens = monthTokens(now);
  const cap = monthlyCap(env);
  let level: UsageLevel = "ok";
  if (cap !== null) {
    if (tokens >= cap) level = "over";
    else if (tokens >= cap * 0.8) level = "warn";
  }
  return { month: now.toISOString().slice(0, 7), tokens, cap, level };
}

/** The hard cap from VIGIL_MONTHLY_TOKEN_HARD_CAP (ADR-0032); unset, empty or not a positive number means no hard cap. */
export function hardCap(env: NodeJS.ProcessEnv = process.env): number | null {
  const raw = env.VIGIL_MONTHLY_TOKEN_HARD_CAP;
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
}

/** Throws 429 `monthly-cap-reached` when this month's tokens have reached the hard cap. Call before a run or chat turn starts. */
export function assertUnderHardCap(now: Date = new Date(), env: NodeJS.ProcessEnv = process.env): void {
  const cap = hardCap(env);
  if (cap === null) return;
  const tokens = monthTokens(now);
  if (tokens >= cap) {
    throw new AppError("monthly-cap-reached", `The monthly token cap is reached (${tokens} of ${cap}). New runs start again next month, or raise VIGIL_MONTHLY_TOKEN_HARD_CAP.`, 429);
  }
}

/**
 * Throws 429 `agent-daily-cap-reached` when this agent's runs started today (UTC) have used `cap` tokens. No cap, no check.
 * It limits what a runaway cron agent can spend in a day, even when the monthly cap is far away.
 */
export function assertAgentUnderDailyCap(agent: string, cap: number | undefined, now: Date = new Date()): void {
  if (cap === undefined) return;
  const tokens = agentTokensSince(agent, new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString());
  if (tokens >= cap) {
    throw new AppError("agent-daily-cap-reached", `Agent ${agent} used its daily token limit (${tokens} of ${cap}). It can run again tomorrow (UTC), or raise the limit on the agent page.`, 429);
  }
}
