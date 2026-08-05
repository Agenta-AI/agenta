# Status

Last updated: 2026-06-10

## Current state

**Implemented, unit-tested, QA-round-1 bugs fixed and re-verified on the dev
stack.** Committed on `fix/playground-keep-drafts-on-testset-connect`, PR
#4604 stacked on `release/v0.103.0` (the v0.103.0 release PR, #4584).

## QA round 1 (2026-06-10)

QA reported three bugs against the first commit: Cancel still loaded the
test set, the modal fired with an inflated draft count, and the picked test
set rows rendered behind the modal. All three shared one root cause: the
selection modal committed the picked ids into the global testcase ids atom
(`commitSelectionDraft`) before the keep/discard decision. Fixed in two
layers: `LoadModeContent` load mode now discards the draft instead of
committing it (the connect populates ids itself), and `TestsetDropdown`
clears stale ids in local mode before measuring drafts. A follow-up review
also found and fixed: `meaningfulLocalRows` counted rows the user had
removed (`hiddenTestcaseIds`), which would have resurrected deleted rows on
keep; and a guard against confirming the selection modal with no real test
set picked (the `"local"` sentinel). All three QA scenarios plus the
no-draft and keep paths re-verified in Chrome against the dev stack.

## Done

- Research and root cause analysis ([research.md](research.md)).
- Decisions confirmed with Mahmoud ([plan.md](plan.md) Decisions section):
  post-confirm modal; chat gets a warning modal; connected-mode change-testset
  guard untouched; copy delegated.
- Implementation:
  - `meaningfulLocalRows` selector in
    `web/packages/agenta-entities/src/loadable/controller.ts` (local-mode rows
    with user-entered data; blank seeded rows and blank chat message shells
    excluded; returns [] when connected).
  - `connectToTestsetKeepingLocalRows` compound action in
    `web/packages/agenta-playground/src/state/controllers/playgroundController.ts`
    (capture before connect, then re-import as unsaved additions; plain
    connect fallback in chat mode). `ConnectToTestsetPayload` is now exported
    from `@agenta/playground`.
  - `KeepDraftRowsModal` in
    `web/oss/src/components/Playground/Components/Modals/KeepDraftRowsModal/`
    with variants `keep` and `chat-replace`.
  - Wiring in
    `web/oss/src/components/Playground/Components/TestsetDropdown/index.tsx`:
    `handleLoadConfirm` opens the modal when meaningful drafts exist;
    `handleCreateAndLoad` keeps drafts unconditionally (the created test set
    is empty, so they become the first unsaved rows).
- Tests (all passing):
  - `web/packages/agenta-entities/tests/unit/loadable-meaningful-local-rows.test.ts`
    (7 tests).
  - `web/packages/agenta-playground/tests/unit/connectToTestsetKeepingLocalRows.test.ts`
    (3 tests).
- `pnpm turbo run build --filter=@agenta/entities --filter=@agenta/playground`
  and `pnpm lint-fix` pass. OSS `types:check` reports no errors in the
  changed files (the suite has many pre-existing failures elsewhere).

## Next steps

1. Manual QA on the dev stack (see plan.md Phase 3, item 7): trace > connect
   test set > keep > sync changes; discard path; Create & Load with drafts;
   chat warning; trace row with mismatched columns.
2. Commit and open a PR.

## Known limitations (accepted for v1)

- Chat mode: drafts cannot be kept (single-testcase gate); the modal only
  warns. Create & Load in chat still replaces the conversation silently,
  matching previous behavior.
- Kept rows with columns missing from the test set surface as "(new)" columns
  on commit (existing view-layer behavior).
- Chat-mode coverage is manual only: `isChatModeAtom` is derived from the
  workflow molecule, which the unit harness does not stand up.

## Decisions log

- 2026-06-09: scope v1 to the local-mode connect path (and Create & Load);
  leave the connected-mode change-testset guard unchanged. Confirmed.
- 2026-06-09: treat trace-derived and manual rows identically. The state
  layer cannot distinguish them anyway (`setRows` discards the
  `trace-input-0` id), and the user expectation is the same.
- 2026-06-09: chat mode shows a replace warning instead of a keep option.
  Confirmed by Mahmoud.
- 2026-06-09: Create & Load keeps drafts without prompting; the alternative
  silently wipes them into an empty test set.
