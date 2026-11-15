import { describe, expect, it } from "vitest";
import { dbPath } from "./index-db";
import { statePath } from "./state-db";
import { REPO_ROOT, vaultDir } from "./vault";

describe("test-setup", () => {
  it("default paths point into the temp directory, not the repo", () => {
    expect(vaultDir().startsWith(REPO_ROOT)).toBe(false);
    expect(dbPath().startsWith(REPO_ROOT)).toBe(false);
    expect(statePath().startsWith(REPO_ROOT)).toBe(false);
  });
});
