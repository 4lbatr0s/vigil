import { afterEach, describe, expect, it, vi } from "vitest";
import { visiblePoll } from "./poll";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function setVisibility(state: "visible" | "hidden"): void {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
  document.dispatchEvent(new Event("visibilitychange"));
}

describe("visiblePoll", () => {
  it("calls now, repeats while visible, pauses when hidden, resumes with one immediate call", () => {
    vi.useFakeTimers();
    setVisibility("visible");
    const fn = vi.fn();
    const stop = visiblePoll(fn, 1000);
    expect(fn).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(3000);
    expect(fn).toHaveBeenCalledTimes(4);
    setVisibility("hidden");
    vi.advanceTimersByTime(10_000);
    expect(fn).toHaveBeenCalledTimes(4);
    setVisibility("visible");
    expect(fn).toHaveBeenCalledTimes(5);
    vi.advanceTimersByTime(1000);
    expect(fn).toHaveBeenCalledTimes(6);
    stop();
    vi.advanceTimersByTime(5000);
    expect(fn).toHaveBeenCalledTimes(6);
  });
});
