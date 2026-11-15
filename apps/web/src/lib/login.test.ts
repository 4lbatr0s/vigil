import { describe, expect, it } from "vitest";
import { ApiError } from "./api";
import { loginMessage, safeNext } from "./login";

describe("safeNext", () => {
  it("keeps same-site paths with queries", () => {
    expect(safeNext("/agents/digest")).toBe("/agents/digest");
    expect(safeNext("/?note=a%20b")).toBe("/?note=a%20b");
  });
  it("turns everything else into the home page", () => {
    for (const bad of [null, undefined, "", "agents", "//evil.example", "https://evil.example", "/\\evil.example", "javascript:alert(1)", "/a\nb", "/login", "/login?next=/x"]) {
      expect(safeNext(bad), String(bad)).toBe("/");
    }
  });
});

describe("loginMessage", () => {
  it("says the plain thing for each failure", () => {
    expect(loginMessage(new ApiError("unauthorized", "x"))).toBe("That token isn't right.");
    expect(loginMessage(new ApiError("too-many-attempts", "x"))).toBe("Too many tries. Wait a minute and try again.");
    expect(loginMessage(new TypeError("fetch failed"))).toBe("Can't reach the server.");
  });
});
