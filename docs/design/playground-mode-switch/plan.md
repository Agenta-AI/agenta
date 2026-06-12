# Plan

Four stacked PRs. Each lands green on its own. Nothing is user-visible until
the end of PR3, when both switch directions and the sync gate work together.
File references and gaps: see [research.md](research.md). Scope decisions and
their reasons: see [context.md](context.md), "V1 scope decisions".

## PR1: split capability from behavior

Goal: `is_chat` stops doing two jobs. Zero visible change.

1. Add a mode override atom in `@agenta/playground` state:
   `"chat" | "completion" | null` (null = follow the app's capability).
   Persist per app via `atomWithStorage` (key `agenta:playground:mode`, one
   record keyed by app id, derived scoped atom; web/CLAUDE.md pattern).
   Only meaningful when the app is chat-capable; ignore it otherwise.
2. Rewire `isChatModeAtom` and `appTypeAtom`
   (`agenta-playground/src/state/execution/selectors.ts:1106-1125`) to
   return `override ?? capability`. Leave `executionModeAtomFamily`
   (entities layer) untouched.
3. Audit every consumer in the research table (section 2). Confirm each one
   reads mode through the rewired selectors rather than through
   `workflowMolecule.selectors.executionMode` directly. `buildRequestBody`
   takes mode as a parameter, so trace each caller.
4. Reset rule: clear the override when the app changes or when the stored
   value equals the capability default.

Tests: unit test the effective-mode selector (`tests/unit/`). Manual smoke
of both app types with the override forced from devtools.

## PR2: chat → completion (behind a flag)

Goal: a chat app runs as a completion playground over the same rows.

1. **Switch transform** (pure, unit-tested, in `@agenta/playground`
   helpers): given the working copy, write the frozen conversation to the
   row's `messages` column and surface the last assistant reply as the
   row's latest run result. Strip run metadata; never include the variant's
   template system message. Write the reverse transform here too
   (conversation = `messages` + latest result) so round-trip identity tests
   exist from day one, even though PR3 wires it.
2. **Verify the system-message rule** (research risk 2): confirm the
   working copy and serializer exclude the variant's template system
   message. Fix if not.
3. **Load path**: keep the `messages` field when loading test sets in
   completion mode for chat apps (`MESSAGE_FIELD_KEYS` filter in
   `loadTestsetNormalizedMutation.ts`).
4. **Messages column card**: render the row's `messages` column inside the
   completion generation rows as an editable conversation card. Compose
   from `ChatMessageList` + `TypeChip` (drill-in `MessagesField` precedent).
5. **Run semantics**: per-row runs pass the row's `messages` as the
   explicit `runParams.chatHistory` (`executionItems.ts:640`); the reply
   lands in the run result slot, not the column. Run all covers every row.
   Multiple loaded test cases work (the single-row gates apply only when
   the behavior mode is chat).
6. **Chrome**: `ModeSwitcher` segmented control in `@agenta/playground-ui`
   (Ant `Segmented`, Phosphor `ChatCircle` / `Rows`, specs in the handoff
   README section 1; precedent `ThemeSwitcher.tsx`). It replaces the
   `ExecutionHeader` title; collapse-all relocates to an icon-only quiet
   button with tooltip "Collapse all test cases". Behind a feature flag.
7. **Dialogs**: confirm dialog (`EnhancedModal`, width 480, "Switch to
   Completion?", two lines, Cancel / Switch). Skip it when the chat has
   zero turns. Post-switch dismissible info banner; copy references the
   `messages` column.
8. Compare mode: the toggle renders disabled in comparison view, with a
   tooltip ("Switching modes is available outside compare view"). Decided;
   no "focused variant" concept gets built.

Deliverable: with the flag on, the section 2 storyboard works end to end
for a single variant, with copy adjusted for `messages`.

## PR3: completion → chat, sync gate, expose the toggle

Goal: the way back, made safe, then shipped.

1. **Reverse switch**: the chosen row's `messages` plus its latest run
   result become the conversation (latest output only; earlier runs stay in
   observability). A variables-only row opens an empty conversation with
   its columns loaded. The existing extract path
   (`extractAndLoadChatMessages`) does most of the work.
2. **Picker**: when several rows are loaded, a dialog asks which one to
   load as the conversation. Default to the last-run or last-edited row.
   The others stay in the test set. (Tabs replace this in PR4.)
3. **Sync gate** (both directions, shown before any other dialog):
   `EnhancedModal`, width 500, warning icon, "Sync your test cases first".
   Body lists the actual unsynced case names and the connected test set
   name (`meaningfulLocalRows`, per-row `testcaseMolecule.isDirty`,
   `connectedSource`). Footer: left-aligned quiet red text button "Switch
   without syncing" (the escape hatch stays; decided), spacer, Cancel,
   primary "Sync & switch" (`commitChanges`, then proceed). When no test
   set is connected, the primary becomes "Save as test set" with a name
   input (`setName` + `saveAsNewTestset`), reusing the TestsetDropdown
   save-new config where possible.
4. **Expose the toggle**: remove the flag once both directions and the gate
   pass QA.
5. Align the TestsetDropdown `"chat-replace"` behavior with the new
   reality where useful; do not expand its scope.

Deliverable: boards 3 (with picker instead of tabs) and 4.1 work; switching
with dirty rows always routes through the gate; round trips are identity.

## PR4 (later): per-row conversations and tabs

Goal: the design's end state. Chat holds N conversations, one visible.

1. Spike first: re-key the chat working copy from `loadableId` to
   `(loadableId, rowId)`, or add a conversation-id indirection. Check run,
   streaming, compare-mode sessions, and Clear. Fix the write-back fan-out
   (`syncChatMessagesToEntity.ts:125-131`) to target one row.
2. Tab strip above the variable cards (handoff section 2 specs): active tab
   = existing testcase chip style; `+` creates and activates an empty test
   case; hidden with one test case; overflow past ~6 tabs into a "+N more"
   dropdown.
3. Run appends to the active conversation only; Run all runs each loaded
   conversation's next turn.
4. Delete the PR3 picker. Remove the chat single-row gates
   (`playgroundController.ts:567-568, 616-631, 651-653`,
   `webWorkerIntegration.ts:317-319`).
5. This also gives chat-native apps multiple conversations, independent of
   mode switching.

## Edge cases to test (from the handoff matrix, board 4.3)

- Empty chat or no output yet: skip the confirm dialog; a typed-but-unrun
  user turn still freezes into the row; the output slot starts empty.
- No system message duplication on any round trip.
- Edited `messages` after a switch is the conversation now; trace links on
  edited turns are dropped (the column is plain data).
- Only the latest output becomes a turn when switching back.
- Compare mode: the toggle is disabled in comparison view and re-enables
  when the view drops back to one variant.

## QA

1. Unit: switch transforms (round-trip identity, metadata stripping,
   system-message exclusion), effective-mode selector, sync-gate row
   listing.
2. E2E (Playwright, see docs/designs/testing): chat → completion → run →
   edit `messages` → switch back; completion → chat with three rows through
   the picker; sync gate on both paths (sync, and switch-without-syncing).
3. Manual pass against the design boards for the new chrome.
4. `pnpm lint-fix` in `web/`; package builds for `@agenta/playground` and
   `@agenta/playground-ui`.
5. Changelog entry when the toggle becomes visible (end of PR3).
