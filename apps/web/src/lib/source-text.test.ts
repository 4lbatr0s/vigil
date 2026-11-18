import { describe, expect, it } from "vitest";
import { cleanSource, sourceNote } from "./source-text";

describe("cleanSource", () => {
  it("strips caption cues and keeps the spoken text once", () => {
    const vtt = "WEBVTT\n\n1\n00:00:01.000 --> 00:00:03.000\nHello <b>everyone</b>\n\n2\n00:00:03.000 --> 00:00:05.000\nHello everyone\nToday: cells.\n";
    expect(cleanSource(vtt)).toBe("Hello everyone\nToday: cells.");
  });
  it("handles srt time lines with commas and removes extra blank lines", () => {
    expect(cleanSource("1\n00:00:01,000 --> 00:00:02,000\nOne\n\n\n\n2\n00:00:02,000 --> 00:00:03,000\nTwo")).toBe("One\n\nTwo");
  });
  it("leaves ordinary text, including numbers inside sentences, alone", () => {
    expect(cleanSource("Chapter 3\nThe year 1999 was long.")).toBe("Chapter 3\nThe year 1999 was long.");
  });
});

describe("sourceNote", () => {
  it("titles it Source:, tags it and notes the origin", () => {
    expect(sourceNote("Cell biology", "Text.", "https://example.com/a")).toEqual({ id: "source-cell-biology", title: "Source: Cell biology", body: "From: https://example.com/a\n\nText.\n", tags: ["source"] });
  });
  it("copes with an empty title and no origin", () => {
    expect(sourceNote(" ", "Text.", "")).toMatchObject({ title: "Source: Untitled", body: "Text.\n" });
  });
});
