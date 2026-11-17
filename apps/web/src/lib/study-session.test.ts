import { describe, expect, it } from "vitest";
import type { StudyCard } from "./api";
import { answer, current, isFinished, remaining, reveal, startSession } from "./study-session";

const card = (id: string): StudyCard => ({ id, noteId: "n", kind: "qa", front: `Q${id}`, back: `A${id}`, line: 1, isNew: true, due: null, lapses: 0 });

describe("study session", () => {
  it("starts on the first card, hidden, and an answer needs the card revealed first", () => {
    let s = startSession([card("a"), card("b")]);
    expect(current(s)?.id).toBe("a");
    expect(s.revealed).toBe(false);
    expect(answer(s, "good")).toBe(s); // not revealed: nothing happens
    s = reveal(s);
    expect(s.revealed).toBe(true);
    s = answer(s, "good");
    expect(current(s)?.id).toBe("b");
    expect(s.revealed).toBe(false);
    expect(s.done).toBe(1);
  });

  it("finishes after the last answer and counts answers by kind", () => {
    let s = startSession([card("a"), card("b")]);
    s = answer(reveal(s), "easy");
    s = answer(reveal(s), "hard");
    expect(isFinished(s)).toBe(true);
    expect(current(s)).toBeNull();
    expect(s.answers).toEqual({ again: 0, hard: 1, good: 0, easy: 1 });
    expect(reveal(s)).toBe(s);
  });

  it("sends a missed card to the end once, then lets it go", () => {
    let s = startSession([card("a"), card("b")]);
    s = answer(reveal(s), "again"); // a goes to the back: b, a
    expect(remaining(s)).toBe(2);
    s = answer(reveal(s), "good"); // b
    expect(current(s)?.id).toBe("a");
    s = answer(reveal(s), "again"); // a again: not sent back a second time
    expect(isFinished(s)).toBe(true);
    expect(s.done).toBe(2);
    expect(s.answers.again).toBe(2);
  });

  it("an empty queue is finished from the start", () => {
    expect(isFinished(startSession([]))).toBe(true);
  });
});
