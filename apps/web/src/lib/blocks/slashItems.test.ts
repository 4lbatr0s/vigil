import { describe, expect, it } from "vitest";
import { SLASH_GROUPS, slashItems } from "./slashItems";

describe("slashItems", () => {
  it("lists every block in group order when nothing is typed", () => {
    const items = slashItems("");
    const groups = items.map((i) => SLASH_GROUPS.indexOf(i.group));
    expect(groups).toEqual([...groups].sort((a, b) => a - b));
    expect(items.map((i) => i.label)).toContain("Table");
  });

  it("finds a block by its name or its words", () => {
    expect(slashItems("tab")[0]?.label).toBe("Table");
    expect(slashItems("checkbox").map((i) => i.label)).toContain("To-do list");
    expect(slashItems("zzzz")).toEqual([]);
  });

  it("offers a table of contents", () => {
    expect(slashItems("contents")[0]?.label).toBe("Table of contents");
    expect(slashItems("toc")[0]?.label).toBe("Table of contents");
  });

  it("offers Image and Ask an agent only when the page can handle them", () => {
    expect(slashItems("image").length).toBe(0);
    expect(slashItems("image", { onImage: () => undefined })[0]?.label).toBe("Image");
    expect(slashItems("ask", { onAsk: () => undefined })[0]?.label).toBe("Ask an agent");
  });
});
