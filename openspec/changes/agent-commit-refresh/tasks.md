# Tasks

## 1. Root cause

- [x] 1.1 Reproduce on staging v0.121.2, /m and /w, with Pi and Claude Haiku 4.5.
- [x] 1.2 Capture the invoke stream in the browser: `data-committed-revision` is emitted.
- [x] 1.3 Read the session records: the `commit_revision` call and its committed result are stored.
- [x] 1.4 Trace /m's listener to the durable send path that never feeds it.

## 2. Fix

- [ ] 2.1 `useAgentConversation` forwards `onCommittedRevision` to `useSessionLivePreview`.
- [ ] 2.2 `LiveConversation` passes a handler that shares the dedupe set with the part reader.
- [ ] 2.3 Unit test: `useAgentConversation` hands `onCommittedRevision` to the live reader. It fails before 2.1.

## 3. Verify

- [ ] 3.1 `pnpm lint-fix` in `web/`, and the `@agenta/chat` and `@agenta/mobile` unit suites.
- [ ] 3.2 Live on /m: the chip and the instructions move without a reload. Record before and after.
- [ ] 3.3 Codex review until MERGE.

## 4. Follow-ups (separate issues)

- [ ] 4.1 A project-watch event for revision commits, so other sessions and tabs follow manual saves and commits (cases 3 and 5).
- [ ] 4.2 An agent commit must not be silently reverted by a pending auto-save (case 6).
