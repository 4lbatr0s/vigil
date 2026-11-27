import type { Run } from "@vigil/shared";
import { redact } from "./llm";

/**
 * Optional webhook for runs nobody is watching (VIGIL_WEBHOOK_URL). A run that waits for approval, a run that
 * failed, and a finished cron or heartbeat run send one JSON POST. The body names the run and its status, never
 * note text. Sending is best effort: a slow or broken endpoint never changes the run.
 */

export type NotifyEvent = "approval" | "failed" | "finished";

/** What a run's end means for the owner, or null when nothing needs saying (chat turns, child runs, manual runs that worked). */
export function notifyEvent(run: Run): NotifyEvent | null {
  if (run.parentRunId) return null;
  if (run.status === "waiting-approval") return "approval";
  if (run.status === "failed" && run.error === "cancelled") return null;
  if (run.status === "failed" || run.status === "budget-exceeded" || run.status === "step-limit") return "failed";
  if (run.status === "succeeded" && (run.trigger === "cron" || run.trigger === "heartbeat")) return "finished";
  return null;
}

const WORDS: Record<NotifyEvent, string> = {
  approval: "is waiting for your approval",
  failed: "did not finish",
  finished: "finished",
};

export function webhookUrl(env: NodeJS.ProcessEnv = process.env): URL | null {
  const raw = env.VIGIL_WEBHOOK_URL?.trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.protocol === "http:" || url.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

export async function notifyRun(run: Run, env: NodeJS.ProcessEnv = process.env, send: typeof fetch = fetch): Promise<boolean> {
  const url = webhookUrl(env);
  const event = notifyEvent(run);
  if (!url || !event) return false;
  const detail = event === "failed" && run.error ? `: ${redact(run.error)}` : "";
  const body = {
    event,
    text: `Vigil: agent ${run.agent} ${WORDS[event]}${detail}`,
    run: { id: run.id, agent: run.agent, status: run.status, trigger: run.trigger, tokensUsed: run.tokensUsed, error: run.error ? redact(run.error) : null },
  };
  try {
    const res = await send(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(5000) });
    return res.ok;
  } catch (err) {
    // The address can hold a secret, so the log line leaves it out.
    console.warn(`vigil-server webhook failed: ${redact(err instanceof Error ? err.message : "error")}`);
    return false;
  }
}
