import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { backoffDelay, createLive, FALLBACK_AFTER, SLOW_RETRY_MS, type LiveDeps, type LiveEvent, type LiveMode } from "./events";
import { readNdjson } from "./ndjson";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function harness(connect: LiveDeps["connect"]) {
  let visible = true;
  let listener: (() => void) | null = null;
  const events: LiveEvent[] = [];
  const modes: LiveMode[] = [];
  const live = createLive({
    connect,
    onEvent: (e) => events.push(e),
    onMode: (m) => modes.push(m),
    isVisible: () => visible,
    onVisibility: (l) => ((listener = l), () => (listener = null)),
  });
  return {
    live,
    events,
    modes,
    setVisible(v: boolean) {
      visible = v;
      listener?.();
    },
  };
}

const failing = (spy: () => void): LiveDeps["connect"] => async () => {
  spy();
  throw new Error("down");
};

describe("backoffDelay", () => {
  it("doubles from 1 s and caps at 30 s", () => {
    expect([1, 2, 3, 4, 5, 6, 7, 20].map(backoffDelay)).toEqual([1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000]);
  });
});

describe("live client", () => {
  it("reports stream mode and delivers events", async () => {
    async function* gen(): AsyncGenerator<LiveEvent> {
      yield { type: "ping" };
      yield { type: "approval", count: 2 };
    }
    const h = harness(async () => gen());
    h.live.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(h.modes).toEqual(["stream"]);
    expect(h.events).toEqual([{ type: "ping" }, { type: "approval", count: 2 }]);
    h.live.stop();
  });

  it("retries with 1 s, 2 s backoff, then falls back to polling after three failures and retries every 60 s", async () => {
    const attempts: number[] = [];
    const t0 = Date.now();
    const h = harness(failing(() => attempts.push(Date.now() - t0)));
    h.live.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(attempts).toEqual([0]);
    await vi.advanceTimersByTimeAsync(1000);
    expect(attempts).toEqual([0, 1000]);
    await vi.advanceTimersByTimeAsync(2000);
    expect(attempts).toEqual([0, 1000, 3000]);
    expect(h.modes).toEqual(["polling"]); // third failure
    expect(FALLBACK_AFTER).toBe(3);
    await vi.advanceTimersByTimeAsync(SLOW_RETRY_MS - 1);
    expect(attempts).toHaveLength(3);
    await vi.advanceTimersByTimeAsync(1);
    expect(attempts).toEqual([0, 1000, 3000, 3000 + SLOW_RETRY_MS]);
    h.live.stop();
  });

  it("goes back to stream mode when a connection finally works", async () => {
    let calls = 0;
    async function* ok(): AsyncGenerator<LiveEvent> {
      await new Promise(() => undefined); // stays open
    }
    const h = harness(async () => {
      calls += 1;
      if (calls <= 3) throw new Error("down");
      return ok();
    });
    h.live.start();
    await vi.advanceTimersByTimeAsync(0 + 1000 + 2000);
    expect(h.modes).toEqual(["polling"]);
    await vi.advanceTimersByTimeAsync(SLOW_RETRY_MS);
    expect(h.modes).toEqual(["polling", "stream"]);
    h.live.stop();
  });

  it("holds no connection while the tab is hidden and reconnects at once when it is visible again", async () => {
    let calls = 0;
    let aborted = 0;
    const h = harness(async (signal) => {
      calls += 1;
      signal.addEventListener("abort", () => (aborted += 1));
      return (async function* () {
        await new Promise(() => undefined);
      })();
    });
    h.live.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toBe(1);
    h.setVisible(false);
    expect(aborted).toBe(1);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(calls).toBe(1);
    h.setVisible(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toBe(2);
    h.live.stop();
  });

  it("does not connect at all while hidden at start", async () => {
    const spy = vi.fn();
    const h = harness(failing(spy));
    h.setVisible(false);
    h.live.start();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(spy).not.toHaveBeenCalled();
    h.live.stop();
  });
});

describe("readNdjson", () => {
  const body = (...chunks: string[]): ReadableStream<Uint8Array> =>
    new ReadableStream({
      start(controller) {
        for (const c of chunks) controller.enqueue(new TextEncoder().encode(c));
        controller.close();
      },
    });

  it("yields one value per line even when lines are split across chunks", async () => {
    const out: unknown[] = [];
    for await (const v of readNdjson(body('{"a":1}\n{"b"', ':2}\n\n{"c":3}'))) out.push(v);
    expect(out).toEqual([{ a: 1 }, { b: 2 }, { c: 3 }]);
  });

  it("throws on a line that is not JSON", async () => {
    const run = async () => {
      for await (const _ of readNdjson(body('{"a":1}\nnot json\n'))) void _;
    };
    await expect(run()).rejects.toThrow("not valid JSON");
  });
});
