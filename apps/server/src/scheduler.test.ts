import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { AgentSchema, type Agent, type Run } from "@vigil/shared";
import { cronError, latestTickAtOrBefore, nextTickAfter } from "./cron";
import { createScheduler } from "./scheduler";
import { closeState, getSchedule, listAgents, putAgent } from "./state-db";

let root = "";
const saved = { ...process.env };
let clock = new Date("2026-11-15T10:00:00Z");
let started: string[] = [];
let running = new Set<string>();
let failStart = false;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "vigil-sched-"));
  process.env.STATE_DB_PATH = path.join(root, "state.db");
  started = [];
  running = new Set();
  failStart = false;
});

afterEach(async () => {
  closeState();
  process.env = { ...saved };
  await rm(root, { recursive: true, force: true });
});

function cronAgent(over: Partial<Agent> & { expression?: string; timezone?: string } = {}): Agent {
  const { expression, timezone, ...rest } = over;
  return AgentSchema.parse({
    name: "digest",
    systemPrompt: "x",
    trigger: { kind: "cron", expression: expression ?? "0 7 * * *", timezone: timezone ?? "UTC" },
    ...rest,
  });
}

function make(catchUpHours = 24) {
  return createScheduler({
    now: () => clock,
    listAgents,
    startRun: (name) => {
      if (failStart) throw new Error("boom");
      started.push(`${name}@${clock.toISOString()}`);
      return { id: "r" } as Run;
    },
    hasRunning: (name) => running.has(name),
    catchUpWindowMs: catchUpHours * 3_600_000,
  });
}

describe("scheduler", () => {
  it("first sight records a baseline and does not run", () => {
    putAgent(cronAgent());
    make().tick();
    expect(started).toEqual([]);
    expect(getSchedule("digest")?.lastScheduledFor).toBe("2026-11-15T07:00:00.000Z");
  });

  it("runs once for a due tick and not again on the next tick", () => {
    putAgent(cronAgent());
    clock = new Date("2026-11-14T10:00:00Z");
    const s = make();
    s.tick();
    clock = new Date("2026-11-15T07:00:10Z");
    s.tick();
    clock = new Date("2026-11-15T07:00:25Z");
    s.tick();
    expect(started).toHaveLength(1);
    expect(getSchedule("digest")?.lastStartedAt).toBe("2026-11-15T07:00:10.000Z");
  });

  it("catches up once after a restart", () => {
    putAgent(cronAgent());
    clock = new Date("2026-11-14T07:00:30Z");
    make().tick(); // baseline 11-14 07:00
    clock = new Date("2026-11-15T07:30:00Z");
    make().tick(); // new instance over the same state: restart
    make().tick();
    expect(started).toHaveLength(1);
  });

  it("skips a miss older than the catch-up window and notes it", () => {
    putAgent(cronAgent({ expression: "0 7 15 * *" })); // monthly, so a 3 day old miss is possible
    clock = new Date("2026-11-14T10:00:00Z");
    make().tick();
    clock = new Date("2026-11-18T09:00:00Z");
    make().tick();
    expect(started).toEqual([]);
    expect(getSchedule("digest")?.lastSkipReason).toMatch(/catch-up window/);
  });

  it("records a skip when the previous run is still going and still advances", () => {
    putAgent(cronAgent());
    clock = new Date("2026-11-14T10:00:00Z");
    const s = make();
    s.tick();
    running.add("digest");
    clock = new Date("2026-11-15T07:00:05Z");
    s.tick();
    expect(started).toEqual([]);
    expect(getSchedule("digest")).toMatchObject({ lastSkipReason: "previous run still going", lastScheduledFor: "2026-11-15T07:00:00.000Z" });
  });

  it("never runs a disabled agent; re-enabling starts from a baseline, not a run", () => {
    putAgent(cronAgent({ enabled: false }));
    clock = new Date("2026-11-14T10:00:00Z");
    const s = make();
    s.tick();
    clock = new Date("2026-11-15T07:05:00Z");
    s.tick();
    expect(started).toEqual([]);
    expect(getSchedule("digest")).toBeNull();
    putAgent(cronAgent({ enabled: true }));
    s.refresh("digest");
    expect(started).toEqual([]);
    expect(getSchedule("digest")?.lastScheduledFor).toBe("2026-11-15T07:00:00.000Z");
  });

  it("honours the time zone: 07:00 Istanbul fires at 04:00 UTC", () => {
    putAgent(cronAgent({ timezone: "Europe/Istanbul" }));
    clock = new Date("2026-11-14T10:00:00Z");
    const s = make();
    s.tick();
    clock = new Date("2026-11-15T03:59:00Z");
    s.tick();
    expect(started).toEqual([]);
    clock = new Date("2026-11-15T04:00:05Z");
    s.tick();
    expect(started).toHaveLength(1);
  });

  it("does not throw on a bad expression and records a reason", () => {
    putAgent(AgentSchema.parse({ name: "bad", systemPrompt: "x", trigger: { kind: "cron", expression: "nope" } }));
    expect(() => make().tick()).not.toThrow();
    expect(getSchedule("bad")?.lastSkipReason).toBe("bad cron expression");
  });

  it("fires exactly once per calendar day across a daylight-saving change", () => {
    putAgent(cronAgent({ expression: "30 7 * * *", timezone: "America/New_York" }));
    clock = new Date("2026-03-07T12:00:00Z");
    const s = make();
    s.tick();
    // Walk 4 days (spans the 2026-03-08 spring-forward) in 15 minute ticks.
    const end = new Date("2026-03-11T12:00:00Z").getTime();
    while (clock.getTime() < end) {
      clock = new Date(clock.getTime() + 15 * 60_000);
      s.tick();
    }
    // 07:30 New York is 12:30 UTC before the change and 11:30 UTC after it.
    expect(started.map((x) => x.split("@")[1]!.slice(11, 13))).toEqual(["12", "11", "11", "11", "11"]);
  });

  it("persists before starting: a throwing start cannot retry in a tight loop", () => {
    putAgent(cronAgent());
    clock = new Date("2026-11-14T10:00:00Z");
    const s = make();
    s.tick();
    failStart = true;
    clock = new Date("2026-11-15T07:00:05Z");
    s.tick();
    s.tick();
    expect(getSchedule("digest")?.lastScheduledFor).toBe("2026-11-15T07:00:00.000Z");
    expect(getSchedule("digest")?.lastSkipReason).toMatch(/start failed: boom/);
    failStart = false;
    s.tick();
    expect(started).toEqual([]);
  });
});

describe("cron helpers", () => {
  it("validates expression and zone", () => {
    expect(cronError("0 7 * * *", "Europe/Istanbul")).toBeNull();
    expect(cronError("0 7 * *")).toMatch(/5 fields/);
    expect(cronError("0 0 7 * * *")).toMatch(/5 fields/);
    expect(cronError("@daily")).toMatch(/5 fields/);
    expect(cronError("H 7 * * *")).toMatch(/H values/);
    expect(cronError("61 7 * * *")).toMatch(/Bad cron/);
    expect(cronError("0 7 * * *", "Mars/Base")).toMatch(/Unknown time zone/);
  });

  it("includes an exact hit and excludes it from next", () => {
    const at = new Date("2026-11-15T07:00:00Z");
    expect(latestTickAtOrBefore("0 7 * * *", "UTC", at)?.toISOString()).toBe("2026-11-15T07:00:00.000Z");
    expect(nextTickAfter("0 7 * * *", "UTC", at)?.toISOString()).toBe("2026-11-16T07:00:00.000Z");
  });
});
