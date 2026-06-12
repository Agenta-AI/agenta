# Research

Codebase findings as of 2026-06-10 (branch `gitbutler/workspace`). All paths
relative to repo root. Line numbers are approximate and will drift.

## 1. Where mode comes from today

Mode is derived from the workflow entity, per workflow, in the entities
layer:

- `web/packages/agenta-entities/src/workflow/state/runnableSetup.ts:185-203`
  `executionModeAtomFamily(workflowId)` returns `"chat" | "completion"`.
  It checks `entity.flags?.is_chat` first, then falls back to the input
  schema having `properties.messages`.

The playground reads it through two selectors:

- `web/packages/agenta-playground/src/state/execution/selectors.ts:1106-1125`
  `isChatModeAtom` reads the **primary node** (first depth-0 node in
  `playgroundNodesAtom`) and returns `boolean | undefined`.
  `appTypeAtom` maps that to `"chat" | "completion" | undefined`.

This is the seam for the feature. Today one value means both "the app
accepts a messages input" (capability) and "use chat behavior" (behavior).
An override atom consulted inside `isChatModeAtom` and `appTypeAtom` splits
the two: capability stays in `executionModeAtomFamily` (untouched, still
used by other surfaces), behavior becomes `override ?? capability`.

## 2. Every consumer of the mode (must respect the override)

| Code path | Location | What it does |
|---|---|---|
| UI branch chat vs completion | `web/packages/agenta-playground-ui/src/components/ExecutionItems/index.tsx:31-86` | `PlaygroundGenerations` renders `<ChatMode/>` or `<CompletionMode/>` |
| Request body | `web/packages/agenta-playground/src/state/execution/executionItems.ts:1018-1121` | `buildRequestBody(mode, ...)`: completion sends `inputRow`, chat sends `chatHistory` |
| Per-run history source | `executionItems.ts:638-666` | chat builds `chatHistory` from `runParams.chatHistory` **if provided**, else from the message atoms. The explicit parameter is the hook for per-row history in completion mode |
| Input dedup | `executionItems.ts:621-626` | chat deletes `messages` from input variables so the payload never duplicates the conversation |
| Worker run shaping | `web/packages/agenta-playground/src/state/execution/webWorkerIntegration.ts:233-271, 317-319` | reads `isChatModeAtom`, clears previous responses, gates chat to the first display row |
| Testcase load gate | `web/packages/agenta-playground/src/state/controllers/playgroundController.ts:567-568, 616-631` | chat slices loaded test cases to one (`.slice(0, 1)`) |
| Keep-drafts fallback | `playgroundController.ts:651-653` | `connectToTestsetKeepingLocalRows` falls back to plain connect in chat mode |
| Message extraction on load | `playgroundController.ts:590-596` → `helpers/extractAndLoadChatMessages.ts` | populates the chat working copy from a row's `messages` column |
| Variable filtering | `selectors.ts:325-345` | chat hides `messages` and `outputs` keys from variable cards |
| Testset loading | `helpers/loadTestsetNormalizedMutation.ts:24-90` | completion strips message-like fields from rows (`MESSAGE_FIELD_KEYS` at lines 10-18 includes `messages`); chat loads one row and extracts history. Completion mode for a chat app must keep `messages` |
| Header label | `web/packages/agenta-playground-ui/src/components/ExecutionHeader/index.tsx:117-151` | panel title is "Chat" or "Generations" |
| Compare output | `web/packages/agenta-playground-ui/src/components/ExecutionItemComparisonView/index.tsx:10-47` | chat vs completion comparison renderers |
| TestsetDropdown variant | `web/oss/src/components/Playground/Components/TestsetDropdown/index.tsx:126, 298-299` | chat gets `"chat-replace"` connect behavior |

Audit result (PR1, 2026-06-10): every behavior consumer reads
`isChatModeAtom` directly or via `executionController.selectors.isChatMode`
(`executionController.ts:205`), so rewiring that one atom covers them all.
Two reads intentionally stay on the capability, because request shapes
follow what the app accepts, not the UI behavior:

- `entityInputContract.ts:82` (input contract: variables + `messages`).
- `executionItems.ts:539-542` (request mode for `buildRequestBody`).

PR2 note: with completion behavior on a chat app, the worker dispatch
(`webWorkerIntegration.ts:233`, behavior-driven) and `executionItems.ts:540`
(capability-driven) will disagree. PR2 reconciles them: per-row execution
items that send chat-shaped requests with an explicit `runParams.chatHistory`
from the row's `messages` column.

A second, unrelated `executionModeAtomFamily` exists in the playground
package (`execution/atoms.ts:76`, keyed by loadableId): it is execution-state
machinery set from session mode (`reducer.ts:85`), which originates from the
behavior-driven worker dispatch. Do not confuse the two.

## 3. Chat state model: a working copy with a bidirectional adapter

The test case row is the canonical store in **both** modes. Chat keeps a
working copy of the conversation in separate atoms, and an adapter keeps the
two in sync in real time:

- **Working copy**:
  `web/packages/agenta-playground/src/state/chat/messageAtoms.ts:22-85`
  flat message list keyed by **loadableId** (one per playground):
  `messageIdsAtomFamily`, `messagesByIdAtomFamily`,
  `orderedMessagesAtomFamily`.
  `chat/messageTypes.ts:40-156`: `ChatMessage` extends the OpenAI shape with
  `sessionId` (per-variant session; user/system messages use
  `SHARED_SESSION_ID`) and `parentId` (threading). Turns are derived at
  render time.
- **Read direction (row → working copy)**:
  `helpers/extractAndLoadChatMessages.ts` parses the row's `messages` column
  into the atoms when a test case loads.
- **Write direction (working copy → row)**:
  `helpers/syncChatMessagesToEntity.ts` serializes the conversation and
  writes it to the row via `testcaseMolecule.actions.update(rowId, {data:
  {messages}})`. The message reducer calls it after every mutation (add,
  update, remove, truncate): `chat/messageReducer.ts:88, 130, 151, 192`.
  Its header states the intent: "This follows the same real-time pattern
  that completion mode uses."

Serialization rules (`syncChatMessagesToEntity.ts:32-105`): strip internal
metadata (`sessionId`, `parentId`, `id`); include all shared user/system
messages; for per-variant replies, keep only the first (canonical) session;
skip the trailing blank input placeholder.

Why the working copy exists at all (a plain `messages` array cannot express
these): per-variant sessions in compare mode (one conversation, N assistant
replies per turn), streaming and run status, and threading.

Two structural limits, relevant later:

- The working copy is keyed per playground, not per row. Multi-conversation
  chat (tabs) needs re-keying to `(loadableId, rowId)` or equivalent.
- The write-back loops over **all** display rows and writes the same
  conversation to each (`syncChatMessagesToEntity.ts:125-131`). Correct
  today only because chat holds one row.

## 4. Test cases, sync state, and save actions

The loadable layer already has everything the sync gate needs:

- Mode (connected vs local): `loadableController.selectors.mode(loadableId)`;
  connected test set: `loadableController.selectors.connectedSource(loadableId)`
  returns `{id, name}`.
- Unsynced detection:
  `loadableController.selectors.hasLocalChanges(loadableId)`;
  `meaningfulLocalRowsAtomFamily(loadableId)`
  (`web/packages/agenta-entities/src/loadable/controller.ts:510-537`) lists
  rows with real user data, filtering blank/seeded rows;
  per-row dirty: `testcaseMolecule.isDirty(rowId)`
  (`web/packages/agenta-entities/src/testcase/state/molecule.ts:179-182`).
  New rows are prefixed `new-` / `local-`.
- Save actions: `loadableController.actions.commitChanges(loadableId, msg)`
  (`loadable/controller.ts:1148-1238`) and
  `loadableController.actions.saveAsNewTestset(loadableId, {...})`
  (needs `setName` first). After commit, rows reconnect with server ids.
- Existing UI to reuse: `TestsetDropdown`
  (`web/oss/src/components/Playground/Components/TestsetDropdown/index.tsx:84-349`,
  wires all four actions, has `EntityCommitModal` from `@agenta/entity-ui`),
  `KeepDraftRowsModal`, `TestsetDisconnectConfirmModal` (both under
  `web/oss/src/components/Playground/Components/Modals/`).
- Sync badge: `PlaygroundSyncStateTag` in
  `web/oss/src/components/Playground/Playground.tsx:29-53`.

## 5. Messages-column UI building blocks

Completion mode for a chat app must render the row's `messages` column as an
editable conversation card. What exists:

- **Editable**: `ChatMessageList` from `@agenta/ui/chat-message`. Already
  used for config system messages in chat mode and by the drill-in messages
  form: `web/packages/agenta-ui/src/drill-in/FieldRenderers/MessagesField.tsx`
  (renders `ChatMessageList`, supports edit and stringify-back).
  `TestcaseDataEditor`
  (`web/packages/agenta-entity-ui/src/testcase/TestcaseDataEditor.tsx:39-56`)
  already treats `dataType === "messages"` specially, with Form / JSON /
  YAML view options and a `TypeChip`.
- **Read-only**: `ChatMessagesCellContent`
  (`web/packages/agenta-ui/src/CellRenderers/ChatMessagesCellContent.tsx:170-232`),
  dispatched by `SmartCellContent` when the preview renderer is `chat`.
- **Gap**: no inline messages-column card inside the completion generation
  rows. We compose one from `ChatMessageList` + `TypeChip`. The purple
  dashed `messages` tag styling from the mock does not exist in code (no
  `#722ed1`/`#b37feb` hits); match whatever `TypeChip` does, per the "real
  app wins" fidelity rule.

## 6. Compare mode and the "focused variant"

- `isComparisonViewAtom`:
  `web/packages/agenta-playground/src/state/execution/displayedEntities.ts:171-175`
  (true when more than one displayed entity).
- Displayed entities: `entityIdsAtom` in
  `web/packages/agenta-playground/src/state/atoms/playground.ts`; there is
  also a `selectedNodeIdAtom`.
- No "focused variant" concept exists, and we do not introduce one: the
  toggle is disabled in comparison view (scope decision 5 in context.md).
  If that ever changes, note that the write-back serializer already picks
  the first non-shared session as canonical when freezing
  (`syncChatMessagesToEntity.ts:63-72`).

## 7. Header and chrome

"Chrome" here means the framing UI around the content (header controls,
dialogs, banner, later the tab strip), as opposed to the message and output
cards themselves.

- `ExecutionHeader`
  (`web/packages/agenta-playground-ui/src/components/ExecutionHeader/index.tsx:44-187`):
  collapsible label ("Chat" / "Generations"), collapse-all via
  `executionItemController.selectors.allRowsCollapsed`, Clear and Run all
  buttons. The segmented control replaces the label; collapse-all relocates
  to an icon-only button right of the spacer.
- Ant `Segmented` precedent with Phosphor icons:
  `web/oss/src/components/Layout/assets/ThemeSwitcher.tsx:10-45`.
- Icons: Phosphor (`@phosphor-icons/react`) is the standard. No Lucide.
  Suggested: chat = `ChatCircle`, completion = `Rows`, sync/swap =
  `ArrowsClockwise` / `Swap`.
- Modals: use `EnhancedModal` from `@agenta/ui`, not raw antd `Modal`
  (web/CLAUDE.md rule).

## 8. Conventions that constrain the implementation

- Package layering: `shared ← ui ← entities ← entity-ui ← playground ←
  playground-ui`. The mode override atom and switch transforms belong in
  `@agenta/playground` (state); the visual chrome belongs in
  `@agenta/playground-ui`; app-level dialogs that touch testset flows can
  live next to the existing modals in
  `web/oss/src/components/Playground/Components/Modals/`.
- Persisted state: the mode override survives reloads via localStorage,
  using Jotai's `atomWithStorage` with an `agenta:` key. The repo pattern
  keeps one stored record mapping app id → value, with a derived atom that
  exposes only the current app's entry (web/CLAUDE.md, "Persisted state").
- Package unit tests live in `tests/unit/`, not `src/`.
- Verify packages with `pnpm turbo run build --filter=@agenta/<package>`
  and `pnpm lint-fix` in `web/` before committing.

## 9. Remaining gaps and risks

1. **Completion-mode load strips `messages`.** `MESSAGE_FIELD_KEYS` in
   `loadTestsetNormalizedMutation.ts:10-18` removes the `messages` field
   when loading test sets in completion mode. Chat apps in completion mode
   need that column kept (PR2).
2. **Template system message round-trip.** The variant's system message must
   never end up in the row's `messages` column. Verify what the working
   copy holds and what the serializer writes before relying on round-trip
   identity (PR2 task).
3. **Result slot vs column.** In chat mode the assistant reply lands in the
   working copy (and so in the column). In completion mode it must land in
   the run result slot instead, with the column frozen. The switch transform
   and the run path share this rule (PR2).
4. **Multi-conversation chat.** Working copy keyed per playground; write-back
   fans out to all rows. Only blocking for tabs (PR4).

There is no backend risk: scoping to chat apps means every run is an
ordinary chat request, and per-row history is already supported via the
explicit `runParams.chatHistory` parameter (`executionItems.ts:640`).
