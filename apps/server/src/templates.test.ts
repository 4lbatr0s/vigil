import { describe, expect, it } from "vitest";
import { TEMPLATES } from "@vigil/shared";
import { cronError } from "./cron";

describe("template cron expressions", () => {
  it("are valid for the scheduler's parser", () => {
    for (const t of TEMPLATES) {
      if (t.agent.trigger.kind === "cron") expect(cronError(t.agent.trigger.expression, t.agent.trigger.timezone), t.id).toBeNull();
    }
  });
});
