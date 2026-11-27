import type { AskCase } from "./scoring";

/** A small fixed vault for the evals. Never the owner's notes: the runner writes these to a temp folder. */
export const EVAL_NOTES: { id: string; title: string; body: string }[] = [
  { id: "enthalpy", title: "Enthalpy", body: "# Enthalpy\n\nEnthalpy is the heat content of a system at constant pressure.\nExothermic reactions release heat, so the enthalpy change is negative.\nEndothermic reactions absorb heat, so the enthalpy change is positive." },
  { id: "entropy", title: "Entropy", body: "# Entropy\n\nEntropy measures the disorder of a system.\nThe second law says the entropy of an isolated system never decreases." },
  { id: "photosynthesis", title: "Photosynthesis", body: "# Photosynthesis\n\nPlants make glucose from carbon dioxide and water using light.\nThe light reactions happen in the thylakoid membranes.\nThe Calvin cycle happens in the stroma." },
  { id: "french-revolution", title: "French Revolution", body: "# French Revolution\n\nThe Bastille was stormed on 14 July 1789.\nThe monarchy was abolished in 1792.\nThe Reign of Terror lasted from 1793 to 1794." },
  { id: "binary-search", title: "Binary search", body: "# Binary search\n\nBinary search finds a value in a sorted array by halving the range each step.\nIts running time is O(log n).\nIt needs random access to the array." },
  { id: "project-kickoff", title: "Project kickoff", body: "# Project kickoff\n\nThe kickoff meeting is on Monday at 10:00.\nMaria owns the schedule and Tom owns the budget.\nThe first milestone is the prototype in March." },
];

export const ASK_CASES: AskCase[] = [
  { id: "direct", question: "What is enthalpy?", expect: "covered", sources: ["enthalpy"] },
  { id: "detail", question: "Is the enthalpy change negative or positive for exothermic reactions?", expect: "covered", sources: ["enthalpy"] },
  { id: "other-topic", question: "Where does the Calvin cycle happen?", expect: "covered", sources: ["photosynthesis"] },
  { id: "date", question: "When was the Bastille stormed?", expect: "covered", sources: ["french-revolution"] },
  { id: "complexity", question: "What is the running time of binary search?", expect: "covered", sources: ["binary-search"] },
  { id: "people", question: "Who owns the budget for the project?", expect: "covered", sources: ["project-kickoff"] },
  { id: "two-notes", question: "How do entropy and enthalpy differ?", expect: "covered", sources: ["entropy", "enthalpy"] },
  { id: "not-in-notes-no-words", question: "Capital of Mongolia", expect: "not-covered" },
  { id: "not-in-notes-shared-word", question: "What is the capital cost of the project?", expect: "not-covered" },
];
