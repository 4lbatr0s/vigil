# UI audit, 2026-11-17

Owner feedback: "the ui is terrible, it is not useful". Method: screenshots of the real app at desktop width (dark theme), page by page, then fixes for what blocked people most. Phone width and the light theme were not re-checked in this pass.

## Found and fixed
- **Study helpers were unreachable.** Ask, Gap check, Recall, Outline, Capture and Import had no link anywhere except the command palette. Now a **Tools** page and nav item lists them with one line each.
- **Eight flat nav links.** Now four labelled groups (Write: Notes, Canvas, Graph; Learn: Today, Study, Tools; Agents: Agents, Chat, Approvals; App: Settings); in the narrow rail the groups are hairlines.
- **Model setup was a paragraph of environment variables.** Now Settings, AI models: provider cards, Test and list models, default model. The "No AI model" banner links straight to it and no longer fires for a local server that needs no key.
- **Settings was one run-on page** with the most important section last. Models first, a sticky jump bar, a rule and room between sections, one heading style (the child components' headings were unstyled before).
- **Agents could only be made from templates.** Now a "Create an agent" wizard, and the agent page edits schedule, tools, connection and model.
- **Agents page repeated "Model: ready." on every template** and had no way to find one. Now it says something only when a model is missing, and has a search box.
- **The graph could not be edited.** A Canvas now exists (see ADR-0027).

## Second round (same day)
- **Notes:** the new-note title box was cut to a few letters beside two buttons; it now has a full row.
- **Chat:** the empty state was one grey line ("Add an agent first"); it now says what chat is and links to Create an agent.
- **Approvals:** reviewed, fine as it is (clear empty state).
- **Canvas in the light theme:** checked with colored cards, a group and an arrow label; readable.

## Seen, not fixed yet
- Today was not redesigned beyond "Start here" and Capture.
- Phone widths (the browser window here cannot be resized) and keyboard-only use of the wizard and canvas toolbar were not checked.
- The agent page is long; sections could collapse.
