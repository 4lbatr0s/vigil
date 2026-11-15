import type { Run } from "@vigil/shared";

/** Mirrors the server's stream (apps/server/src/events.ts). Ids, counts and statuses only. */
export type LiveEvent =
  | { type: "run"; run: Run }
  | { type: "run-event"; runId: string; seq: number; kind: string }
  | { type: "note"; id: string; change: "created" | "updated" | "deleted"; author: "human" | "agent" }
  | { type: "approval"; count: number }
  | { type: "ping" };

export type LiveMode = "connecting" | "stream" | "polling";

/** 1 s, 2 s, 4 s ... capped at 30 s. `failures` is how many attempts in a row have failed so far (1 = first failure). */
export function backoffDelay(failures: number): number {
  return Math.min(30_000, 1000 * 2 ** Math.max(0, failures - 1));
}

export const FALLBACK_AFTER = 3;
export const SLOW_RETRY_MS = 60_000;

export type LiveDeps = {
  /** Opens the stream; resolves to the events, rejects if it cannot connect. */
  connect: (signal: AbortSignal) => Promise<AsyncIterable<LiveEvent>>;
  onEvent: (event: LiveEvent) => void;
  onMode: (mode: LiveMode) => void;
  isVisible: () => boolean;
  /** Registers a visibility listener; returns its remover. */
  onVisibility: (listener: () => void) => () => void;
};

/**
 * Keeps one live stream open while the tab is visible. Reconnects with exponential backoff; after
 * three failures in a row it reports `polling` (callers then poll as before) and keeps trying
 * once a minute. A hidden tab holds no connection and reconnects the moment it is visible again.
 */
export function createLive(deps: LiveDeps): { start(): void; stop(): void } {
  let failures = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let controller: AbortController | null = null;
  let running = false;
  let removeVisibility: (() => void) | null = null;
  let mode: LiveMode = "connecting";

  const setMode = (next: LiveMode): void => {
    if (next !== mode) {
      mode = next;
      deps.onMode(next);
    }
  };

  const clearTimer = (): void => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };

  const schedule = (): void => {
    clearTimer();
    if (!running || !deps.isVisible()) return;
    const wait = failures >= FALLBACK_AFTER ? SLOW_RETRY_MS : backoffDelay(failures);
    timer = setTimeout(() => void attempt(), wait);
  };

  async function attempt(): Promise<void> {
    if (!running || !deps.isVisible() || controller) return;
    const mine = new AbortController();
    controller = mine;
    try {
      const events = await deps.connect(mine.signal);
      failures = 0;
      setMode("stream");
      for await (const event of events) deps.onEvent(event);
    } catch {
      // A failed or dropped stream is counted below; there is nothing else to do with the error.
    }
    if (controller === mine) controller = null;
    if (mine.signal.aborted) return; // we closed it on purpose (hidden tab or stop)
    failures += 1;
    if (failures >= FALLBACK_AFTER) setMode("polling");
    schedule();
  }

  const onVisible = (): void => {
    if (!running) return;
    if (deps.isVisible()) {
      clearTimer();
      void attempt();
    } else {
      clearTimer();
      controller?.abort();
      controller = null;
    }
  };

  return {
    start() {
      if (running) return;
      running = true;
      removeVisibility = deps.onVisibility(onVisible);
      if (deps.isVisible()) void attempt();
    },
    stop() {
      running = false;
      clearTimer();
      controller?.abort();
      controller = null;
      removeVisibility?.();
      removeVisibility = null;
    },
  };
}
