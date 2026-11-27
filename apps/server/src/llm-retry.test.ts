import { describe, expect, it } from "vitest";
import { AIMessage, type BaseMessage } from "@langchain/core/messages";
import { isRetryable, retryDelayMs, withRetry } from "./llm-retry";
import type { ChatModel } from "./llm";

const ok = new AIMessage("hello");
const httpError = (status: number, headers: Record<string, string> = {}): Error => Object.assign(new Error(`HTTP ${status}`), { status, headers });
const noSleep = async (): Promise<void> => undefined;

/** A model whose first calls fail with the given errors, then answers. */
function flaky(errors: unknown[]): { model: ChatModel; calls: () => number } {
  let n = 0;
  return {
    calls: () => n,
    model: {
      invoke: async () => {
        const err = errors[n];
        n += 1;
        if (err !== undefined) throw err;
        return ok;
      },
    },
  };
}

describe("isRetryable", () => {
  it("retries rate limits, server errors and dropped connections", () => {
    expect(isRetryable(httpError(429))).toBe(true);
    expect(isRetryable(httpError(500))).toBe(true);
    expect(isRetryable(httpError(503))).toBe(true);
    expect(isRetryable(Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" }))).toBe(true);
    expect(isRetryable(Object.assign(new TypeError("fetch failed"), { cause: { code: "UND_ERR_SOCKET" } }))).toBe(true);
    expect(isRetryable(new Error("terminated"))).toBe(true);
  });

  it("does not retry client errors, a model that cannot do something, or a server that is not running", () => {
    expect(isRetryable(httpError(400))).toBe(false);
    expect(isRetryable(httpError(401))).toBe(false);
    expect(isRetryable(httpError(404))).toBe(false);
    expect(isRetryable(httpError(501))).toBe(false);
    expect(isRetryable(Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" }))).toBe(false);
    expect(isRetryable(new Error("something else"))).toBe(false);
    expect(isRetryable("a string")).toBe(false);
  });
});

describe("retryDelayMs", () => {
  it("uses the backoff steps, and Retry-After when the server sends it (capped)", () => {
    expect(retryDelayMs(httpError(500), 0, [500, 1500])).toBe(500);
    expect(retryDelayMs(httpError(500), 1, [500, 1500])).toBe(1500);
    expect(retryDelayMs(httpError(500), 5, [500, 1500])).toBe(1500);
    expect(retryDelayMs(httpError(429, { "retry-after": "2" }), 0, [500, 1500])).toBe(2000);
    expect(retryDelayMs(httpError(429, { "retry-after": "999" }), 0, [500, 1500])).toBe(10_000);
    expect(retryDelayMs(httpError(429, { "retry-after": "soon" }), 0, [500, 1500])).toBe(500);
  });
});

describe("withRetry", () => {
  it("answers on the first try without retrying", async () => {
    const { model, calls } = flaky([]);
    const out = await withRetry(model, { sleep: noSleep }).invoke([]);
    expect(out).toBe(ok);
    expect(calls()).toBe(1);
  });

  it("retries a failing call and reports each retry", async () => {
    const { model, calls } = flaky([httpError(503), httpError(429)]);
    const seen: number[] = [];
    const out = await withRetry(model, { sleep: noSleep, onRetry: (n) => seen.push(n) }).invoke([]);
    expect(out).toBe(ok);
    expect(calls()).toBe(3);
    expect(seen).toEqual([1, 2]);
  });

  it("gives up after three attempts and throws the last error", async () => {
    const { model, calls } = flaky([httpError(500), httpError(500), httpError(502), httpError(500)]);
    await expect(withRetry(model, { sleep: noSleep }).invoke([])).rejects.toThrow("HTTP 502");
    expect(calls()).toBe(3);
  });

  it("does not retry an error that retrying cannot fix", async () => {
    const { model, calls } = flaky([httpError(401)]);
    await expect(withRetry(model, { sleep: noSleep }).invoke([])).rejects.toThrow("HTTP 401");
    expect(calls()).toBe(1);
  });

  it("stops at once when the run is cancelled", async () => {
    const controller = new AbortController();
    const { model, calls } = flaky([httpError(500), httpError(500)]);
    const sleep = async (): Promise<void> => controller.abort();
    const wrapped = withRetry(model, { sleep, signal: controller.signal });
    await expect(wrapped.invoke([])).rejects.toThrow("HTTP 500");
    expect(calls()).toBe(1);
  });

  it("retries opening a stream, not a stream that already started", async () => {
    let opens = 0;
    const model: ChatModel = {
      invoke: async () => ok,
      stream: async (_m: BaseMessage[]) => {
        opens += 1;
        if (opens < 3) throw httpError(503);
        return (async function* () {
          yield new AIMessage("a") as never;
        })();
      },
    };
    const wrapped = withRetry(model, { sleep: noSleep });
    const chunks: unknown[] = [];
    for await (const c of await wrapped.stream!([])) chunks.push(c);
    expect(opens).toBe(3);
    expect(chunks).toHaveLength(1);
  });

  it("leaves a model without stream() without one", () => {
    expect(withRetry({ invoke: async () => ok }, { sleep: noSleep }).stream).toBeUndefined();
  });
});
