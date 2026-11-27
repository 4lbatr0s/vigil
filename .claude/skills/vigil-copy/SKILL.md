---
name: vigil-copy
description: Use when writing or editing any text a Vigil user reads: button labels, headings, empty states, errors, hints, confirmations. Keeps copy short, plain and consistent.
---

# Vigil copy

The reader is a learner who is here to write and study. Say the useful thing and stop.

## Rules

- Sentence case everywhere. No Title Case, no uppercase labels.
- Buttons are verbs that name the result: "Delete note", "Add to inbox", "Turn on". Never "OK", "Submit", "Yes".
- One short sentence. A heading needs no explainer line underneath unless it answers a question the learner would have.
- Say what happened, then what to do. Errors sit next to the thing that failed.
- Plain words: "note", not "document object"; "model", not "LLM provider"; "undo", not "revert changeset".
- No exclamation marks, no emoji, no "Let's", no "Oops", no "Please".
- Numbers are numerals ("3 notes"). Times are relative when recent ("2 h", "Yesterday").
- An agent is named by what it does ("Morning digest"). Agent activity says who did it: "Written by morning-digest".

## Before and after (from the current app)

| Where | Before | After |
|---|---|---|
| Today, empty | All quiet. Your agents have not done anything since you last looked. See your agents. | Nothing new since you last looked. |
| Agents, empty | Describe what you want and a model drafts it, or start from a ready-made one below. Agents stay off until you turn them on. | No agents yet. (button: Create an agent) |
| Study, empty | Your cards are resting. They will come back when it is time. | No cards due. |
| Banner | No AI model is connected yet, so agents cannot run. Connect one in Settings. | (Agents and Chat only) Connect a model to run agents. (link: Settings) |
| Delete | Are you sure you want to delete this note? | Delete this note? (button: Delete note, other button: Keep it) |

## Checklist

- Could a word be removed without losing meaning? Remove it.
- Does the button say what will happen?
- Would a learner who has never seen the feature understand it without the paragraph? If not, fix the interface, not the paragraph.
