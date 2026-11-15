import { describe, expect, it } from "vitest";
import { withNoteLock } from "./lock";

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

describe("withNoteLock", () => {
  it("runs tasks one at a time, in call order", async () => {
    const log: string[] = [];
    const task = (n: number): Promise<void> =>
      withNoteLock(async () => {
        log.push(`start-${n}`);
        await wait(10);
        log.push(`end-${n}`);
      });
    await Promise.all([task(1), task(2), task(3)]);
    expect(log).toEqual(["start-1", "end-1", "start-2", "end-2", "start-3", "end-3"]);
  });

  it("keeps going after a task throws", async () => {
    let ran = 0;
    const first = withNoteLock(async () => {
      ran += 1;
      throw new Error("first task failed");
    });
    const second = withNoteLock(async () => {
      ran += 1;
      return "second task ran";
    });
    await expect(first).rejects.toThrowError("first task failed");
    await expect(second).resolves.toBe("second task ran");
    expect(ran).toBe(2);
  });
});
