# Tasks

## 1. Root cause

- [x] 1.1 Reproduce on staging v0.121.2, /m and /w, with Pi and Claude Haiku 4.5.
- [x] 1.2 Confirm the invoke stream carries `data-committed-revision` and the records carry the committed result.
- [x] 1.3 Trace /m's listener to the durable send path that never feeds it.

## 2. Decision

- [x] 2.1 Mahmoud chose Decision 1 option A (adopt).

## 3. Session in view (Decision 1)

- [x] 3.1 `useAgentConversation` forwards `onCommittedRevision` to `useSessionLivePreview`.
- [x] 3.2 `LiveConversation` handles it with the part reader's dedupe set.
- [x] 3.3 Unit test that fails before 3.1.

## 4. Pill, check, drawer, new sessions

- [x] 4.1 A latest-version check (one request) on tab visible, session switch, and drawer open. None while hidden.
- [x] 4.2 The "vN available · Update" pill next to the version chip, on /m and /w. Update adopts and pins.
- [x] 4.3 Remove /w's automatic adoption on return from a hidden tab (case 2); it becomes the pill.
- [x] 4.4 The drawer refetches on open and lists newer versions on top with Update.
- [x] 4.5 A new session resolves the latest version at creation.
- [x] 4.6 Unit tests for the check triggers (no request while hidden) and the pill.

## 5. Verify

- [x] 5.1 `pnpm lint-fix` in `web/`, and the unit suites of the touched packages.
- [x] 5.2 Live on /m and /w, recorded: cases 1, 2, 3, 10 (the drawer), with a commit made elsewhere standing in for cases 4, 5 and 9.
- [ ] 5.3 Codex review until MERGE.

## 6. Follow-ups

- [ ] 6.1 An agent commit must not be silently reverted by a pending auto-save (case 6).
- [ ] 6.3 Make /w's revision per session tab, so an Update or a self-commit in one /w session does not move the others.
- [ ] 6.2 Evaluate publishing `workflow-changed` on revision commits (Decision 3 option).
