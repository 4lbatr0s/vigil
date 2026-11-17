# To do: the agent does these alone

Nothing here needs the owner. The agent works top to bottom, one item per commit, ticks the item here and in `spec/progress.md`, and adds a CHANGELOG line. Commits stay local until the owner says "push". Tests use temp directories; no key is ever printed. What only the owner can do is in [`todo-owner.md`](todo-owner.md).

- [x] 1. **Today: what to study first.** *Done: a "Start here" section (`lib/focus.ts`) with up to three plain lines: exam within a week, changes waiting for your yes, recall checks due, cards, slipping cards. Checked in the browser.* Order the Today page by exam date, due recall checks and cards that keep slipping, in plain words.
- [x] 2. **Gap check marks.** *Done: `/gap` warns when a mark points at a line that was never given (`verdict` bad-marks); marks already link to the note.* Check the `[n]` marks on `/gap` like `/ask` does (reuse `verdict` in `lib/citations.ts`).
- [ ] 3. **Pictures for more agents.** Tutors, quiz master and explain-it-back see a note's pictures when the owner's setting is on (reuse `picturesFor`).
- [ ] 4. **PWA share target for capture.** Share text to Vigil and it lands in the Inbox note.
- [ ] 5. **Nested tag tree** in the note list (`a/b` tags).
- [ ] 6. **Editor chunk size.** Trim the CodeMirror chunk (about 240 KB gzip, loads lazily) and keep the first-load budget.
- [ ] 7. **Logout epoch.** A server-side session epoch so logout invalidates copied cookies.
- [ ] 8. **Login under attack.** A design and tests so many addresses cannot make the owner wait at login.
- [ ] 9. **Chat history.** Summarize older turns instead of only trimming them.
- [ ] 10. **Anki import with history.** Read review history from the plain-text format where it exists (`.apkg` stays out of scope).
- [ ] 11. **Vector search for Ask.** Only if a test on a temp vault shows full-text search misses lines a question needs; decide from the measured result and write it down.
- [ ] 12. **Live re-checks on the local model.** Re-run the weekly study review and Ask with the 16,384-token window and record the result.
