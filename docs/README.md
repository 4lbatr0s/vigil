# Vigil documentation index

Start with `AGENTS.md` at the repo root if you are a coding agent. This page lists every document, what it answers, and who should read it.

| Document | Answers | Status |
| --- | --- | --- |
| `spec/v1-scope.md` | What is v1? The 13 locked product decisions and the cuts. | Frozen 2026-11-14 |
| `spec/roadmap.md` | Which milestones (M0 to M6) and what each one delivers. | Live |
| `spec/implementation-plan.md` | **How to build everything**: work packages, tasks, files, tests, acceptance. | Live, execute this |
| `spec/progress.md` | **What is done and what is next**: one checkbox per task. | Live, update with every task |
| `spec/architecture.md` | How the parts fit: processes, stores, module map, sequences, failure modes. | Live |
| `spec/threat-model.md` | What we protect, from whom, with which controls, and what stays risky. | Live |
| `todo-agent.md` | What the agent can do alone, in order. | Live, tick with every item |
| `todo-owner.md` | What only the owner can do (decisions, real devices, publishing). | Live |
| `spec/open-questions.md` | Decisions that still need the owner, and questions raised while building. | Live |
| `design/ui.md` | Design tokens and component stances ("Quiet Instrument"). | Accepted (ADR-0005) |
| `design/ux-spec.md` | Every screen: layout, states, copy, keyboard, motion, accessibility, icons, app mark. | Live, required for UI tasks |
| `adr/0001` to `0009` | Accepted decisions (storage, product, BYOK, agent runtime, design, fetch model, access, SQLite, LangGraph). | Accepted |
| `adr/0010` to `0014` | Scheduler, strict mode, graph, login, static SPA. | Proposed; accepted when their work package starts |
| `adr/0015` | Product defaults (permissions page, templates off until turned on, retention, soft cap). | Accepted 2026-11-15 |
| `conventions.md` | Code standards every worker follows. | Accepted |
| `glossary.md` | The words this project uses and what they mean. | Live |

## Reading order for a new implementer

1. `../AGENTS.md`
2. `spec/v1-scope.md`
3. `spec/architecture.md`
4. `spec/implementation-plan.md` (sections 0 to 3, then the work package you are on)
5. `spec/progress.md`
6. For UI work: `design/ui.md`, then `design/ux-spec.md`
7. The ADRs named in your task

## Rules for the documents themselves

- A behavior change updates the matching document in the same commit.
- `spec/progress.md` is the only place that records status. Do not write "done" anywhere else except the milestone lines in `spec/roadmap.md`.
- An ADR is never edited after it is Accepted except to add a dated "Amended by ADR-00NN" line; changing a decision needs a new ADR.
- Documents are plain Markdown, no generated content, no secrets.
