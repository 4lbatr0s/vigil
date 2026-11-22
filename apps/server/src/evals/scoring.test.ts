import { describe, expect, it } from "vitest";
import type { Passage } from "@vigil/shared";
import { scoreAsk, summarize, type AskCase, type AskOutcome } from "./scoring";

const passages: Passage[] = [
  { n: 1, noteId: "enthalpy", title: "Enthalpy", line: 3, text: "Enthalpy is the heat content of a system." },
  { n: 2, noteId: "entropy", title: "Entropy", line: 3, text: "Entropy measures disorder." },
];
const covered: AskCase = { id: "c1", question: "What is enthalpy?", expect: "covered", sources: ["enthalpy"] };
const refuse: AskCase = { id: "c2", question: "Capital of Mongolia?", expect: "not-covered" };
const outcome = (over: Partial<AskOutcome>): AskOutcome => ({ caseId: "c1", passages, answer: "Enthalpy is heat content [1].", seconds: 2, ...over });

describe("scoreAsk", () => {
  it("passes a covered answer that cites the expected note", () => {
    expect(scoreAsk(covered, outcome({}))).toMatchObject({ pass: true, verdict: "covered", citedNotes: ["enthalpy"] });
  });

  it("fails a covered answer that cites the wrong note, has no marks, or points at a line never given", () => {
    expect(scoreAsk(covered, outcome({ answer: "Disorder [2]." })).pass).toBe(false);
    expect(scoreAsk(covered, outcome({ answer: "It is heat." }))).toMatchObject({ pass: false, verdict: "no-marks" });
    expect(scoreAsk(covered, outcome({ answer: "Heat [7]." }))).toMatchObject({ pass: false, verdict: "bad-marks" });
  });

  it("fails an empty reply and a failed run, and says why", () => {
    expect(scoreAsk(covered, outcome({ answer: "  " }))).toMatchObject({ pass: false, verdict: "empty" });
    expect(scoreAsk(covered, outcome({ answer: null, failed: "step limit reached" }))).toMatchObject({ pass: false, verdict: "failed" });
  });

  it("passes a refusal when the notes really do not cover the question, with or without calling the model", () => {
    expect(scoreAsk(refuse, outcome({ caseId: "c2", passages: [], answer: null }))).toMatchObject({ pass: true, verdict: "no-call" });
    expect(scoreAsk(refuse, outcome({ caseId: "c2", answer: "Your notes do not cover this." }))).toMatchObject({ pass: true, verdict: "not-covered" });
  });

  it("fails an answer to an unanswerable question, and a refusal of an answerable one", () => {
    expect(scoreAsk(refuse, outcome({ caseId: "c2", answer: "Ulaanbaatar [1]." })).pass).toBe(false);
    expect(scoreAsk(covered, outcome({ answer: "Your notes do not cover this." }))).toMatchObject({ pass: false, verdict: "not-covered" });
    expect(scoreAsk(covered, outcome({ passages: [], answer: null }))).toMatchObject({ pass: false, verdict: "no-call" });
  });
});

describe("summarize", () => {
  it("gives the rates a person compares between models", () => {
    const scores = [
      scoreAsk(covered, outcome({})),
      scoreAsk(covered, outcome({ answer: "Heat [7].", seconds: 4 })),
      scoreAsk(covered, outcome({ answer: "", seconds: 6 })),
      scoreAsk(refuse, outcome({ caseId: "c2", passages: [], answer: null, seconds: 0 })),
    ];
    expect(summarize(scores)).toEqual({ total: 4, passed: 2, passRate: 0.5, emptyRate: 0.25, badMarksRate: 0.25, failedRate: 0, avgSeconds: 3 });
  });

  it("is all zero for no cases", () => {
    expect(summarize([])).toEqual({ total: 0, passed: 0, passRate: 0, emptyRate: 0, badMarksRate: 0, failedRate: 0, avgSeconds: 0 });
  });
});
