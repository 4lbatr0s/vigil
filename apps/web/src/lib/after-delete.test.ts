import { describe, expect, it } from "vitest";
import { nextAfterDelete } from "./after-delete";

describe("nextAfterDelete", () => {
  it("prefers the note below, then the one above, then none", () => {
    expect(nextAfterDelete(["a", "b", "c"], "b")).toBe("c");
    expect(nextAfterDelete(["a", "b", "c"], "c")).toBe("b");
    expect(nextAfterDelete(["a"], "a")).toBeNull();
    expect(nextAfterDelete([], "a")).toBeNull();
  });
  it("falls back to the first note when the id is not in the list", () => {
    expect(nextAfterDelete(["a", "b"], "zzz")).toBe("a");
  });
});
