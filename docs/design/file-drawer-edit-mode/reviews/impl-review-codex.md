# Codex review of the file-drawer edit-mode implementation

- **Reviewer:** OpenAI Codex CLI, `gpt-5.6-sol`, high reasoning effort, read-only sandbox
- **Date:** 2026-08-04
- **Reviewed:** `git diff origin/release/v0.109.0...HEAD` on `feat/file-drawer-edit-mode`
  (three implementation commits: `af1d33c29a`, `2d7220ae5b`, `8301888ee8`)
- **Brief:** skeptical staff engineer; weighted toward code organization, naming, layering,
  state-machine correctness, the save path, and duplication of what the repo already had.
  Praise was explicitly excluded, so the absence of it here is the brief, not the verdict.
- **Raw log:** `/tmp/claude-1000/-home-mahmoud-code-agenta-2/8f46ac2c-617d-4f0c-a875-dafc5d4c34fc/scratchpad/codex-runs/implreview.log`

## Orchestrator spot-checks

Three of the four blocking findings were verified against source before filing:

- **B1 confirmed.** `web/packages/agenta-ui/src/Editor/plugins/code/utils/editorCodeUtils.ts:121,145`
  converts tab nodes to two spaces and returns `result.trimEnd()`;
  `web/packages/agenta-ui/src/Editor/plugins/code/index.tsx:128-136` pretty-prints compact JSON
  on hydration. Byte fidelity for `.json`, and for any file with trailing whitespace or a
  trailing blank line, is not currently achieved.
- **B2 confirmed.** `useDriveEditController.ts` `onOverwrite` calls `overwriteNextSave()` then
  `onSave()`, and `onSave` returns early on `current.draft === current.original`, leaving
  `skipConflictCheckOnce` armed on the buffer.
- **B3 structurally confirmed.** `state.ts:63` is a module-global `atom<DriveEditBuffer | null>(null)`
  with no drawer scoping; `driveKey` is stored on the buffer but not used to scope consumers.
  Whether two Files drawers actually co-mount today was not verified.

B4 and the S/N findings were not independently verified.

---

## Verdict

Not mergeable as-is. The current implementation can silently rewrite untouched bytes, permanently bypass conflict detection after a no-op overwrite, and leak one drawer’s edit state into other mounted drawers. Those correctness defects require fixes before the structural cleanup and missing tests can be evaluated.

## Blocking

### B1. The selected editor is not byte-preserving

- **Where:** `web/oss/src/components/Drives/editMode/components/DriveFileEditor.tsx:40`, `web/packages/agenta-ui/src/Editor/plugins/code/utils/editorCodeUtils.ts:121`, `web/packages/agenta-ui/src/Editor/plugins/code/utils/editorCodeUtils.ts:145`, `web/packages/agenta-ui/src/Editor/plugins/code/index.tsx:128`
- **What is wrong:** `DriveFileEditor` uses the default custom code-node path. Its serializer converts tab nodes to two spaces and calls `trimEnd()`, while compact JSON is pretty-printed during hydration.
- **What breaks:** Editing one character in a file ending with newlines or trailing spaces removes those bytes; compact JSON can be reformatted wholesale. The claimed `.txt`, `.md`, `.env`, `.csv`, and `.json` byte fidelity is false.
- **Fix:** Use a byte-preserving editor path—the existing native code-node mode is the smallest candidate—and add an editor-to-Blob test covering trailing newlines, trailing spaces, tabs, CRLF, non-ASCII, and empty content.

### B2. Overwrite can leave conflict detection permanently bypassed

- **Where:** `web/oss/src/components/Drives/editMode/useDriveEditController.ts:207`, `web/oss/src/components/Drives/editMode/useDriveEditController.ts:213`, `web/oss/src/components/Drives/editMode/useDriveEditController.ts:276`, `web/oss/src/components/Drives/editMode/state.ts:206`
- **What is wrong:** `onOverwrite` arms `skipConflictCheckOnce` before calling `onSave`, but `onSave` can return without starting a request when the draft equals the original.
- **What breaks:** After a conflict, revert the draft to its original value and click Overwrite. The conflict disappears and the bypass remains armed; the next real edit skips the pre-write check and silently overwrites the external version.
- **Fix:** Pass `skipConflictCheck: true` directly to a validated save invocation. Do not persist the bypass in buffer state unless a request has actually started.

### B3. The module-global buffer contaminates independent drawers

- **Where:** `web/oss/src/components/Drives/editMode/state.ts:63`, `web/oss/src/components/Drives/DriveExplorer.tsx:118`, `web/oss/src/components/Drives/editMode/components/DriveEditBar.tsx:16`, `web/oss/src/components/Drives/editMode/components/DriveEditBanner.tsx:15`, `web/oss/src/components/AgentChatSlice/AgentChatPanel.tsx:249`
- **What is wrong:** Every Files drawer shares one unscoped atom. `DriveEditBuffer.driveKey` is written but never read to scope any consumer, while inactive conversation panes can remain mounted.
- **What breaks:** Editing in session A can make session B’s tree inert, display A’s banner or guard modal, and route B’s navigation through A’s buffer. A config drawer or attachment drawer can exhibit the same contamination.
- **Fix:** Give each `FilesDrawer` its own Jotai store/provider outside the `DriveExplorer` remount boundary, or key every atom and consumer by a stable drawer identity.

### B4. Content and `baseMtime` can describe different file versions

- **Where:** `web/oss/src/components/Drives/editMode/useDriveEditController.ts:123`, `web/oss/src/components/Drives/editMode/useDriveEditController.ts:131`, `web/oss/src/components/Drives/editMode/useDriveEditController.ts:180`, `web/packages/agenta-entities/src/session/state/mounts.ts:193`
- **What is wrong:** Edit can open from cached content while the content query is refetching because only `isPending` is exposed. The independent directory query may already contain the new mtime.
- **What breaks:** An agent write invalidates both queries; the listing refetch finishes first, then Edit captures old content with the new mtime. The pre-write check sees that same new mtime and permits overwriting the agent’s content without a conflict.
- **Fix:** Disable Edit while either query is fetching and establish a coherent snapshot with listing → fresh content → listing, retrying when the two listing mtimes differ.

## Should fix before merge

### S1. Selecting a known oversized text file still downloads it

- **Where:** `web/oss/src/components/Drives/editMode/useDriveEditController.ts:117`, `web/oss/src/components/Drives/editMode/useDriveEditController.ts:123`, `web/oss/src/components/Drives/editMode/model.ts:38`
- **What is wrong:** `resolved` is created and `useDriveFileText` subscribes before the known listing size is used to reject editing.
- **What breaks:** Selecting a 100 MB log triggers the content request even though both preview and Edit are capped at 1.5 MB.
- **Fix:** Pass an empty mount/path to the content query when the known byte size exceeds `TEXT_CAP`.

### S2. The fallback cap compares UTF-16 units with a byte limit

- **Where:** `web/oss/src/components/Drives/editMode/useDriveEditController.ts:134`, `web/oss/src/components/Drives/editMode/model.ts:41`
- **What is wrong:** `content.length` is not the UTF-8 byte size represented by `TEXT_CAP`.
- **What breaks:** With a missing or stale listing size, multibyte content substantially over 1.5 MB remains editable.
- **Fix:** Compare `new Blob([content]).size` or `TextEncoder` byte length.

### S3. “Reload from disk” is an impossible action for a deleted file

- **Where:** `web/oss/src/components/Drives/editMode/components/DriveEditBanner.tsx:36`, `web/oss/src/components/Drives/editMode/components/DriveEditBanner.tsx:48`, `web/oss/src/components/Drives/editMode/useDriveEditController.ts:490`
- **What is wrong:** A `missing` conflict still offers Reload even though no remote body exists.
- **What breaks:** Reload always fails, replaces the specific deletion conflict with a generic error, and leaves the user in a retry loop.
- **Fix:** Hide Reload for `reason === "missing"`, or define an explicit deleted-file resolution that preserves the conflict.

### S4. Drawer shortcuts are registered against the entire window

- **Where:** `web/oss/src/components/Drives/editMode/useDriveEditController.ts:281`, `web/oss/src/components/Drives/editMode/useDriveEditController.ts:301`
- **What is wrong:** The handler does not verify that focus or the event target is inside this drawer.
- **What breaks:** With a drawer open, Cmd/Ctrl+E, Cmd/Ctrl+S, or Escape typed in the chat composer or another surface can open, save, or cancel the file editor. Multiple mounted drawers register competing handlers.
- **Fix:** Attach the handler to the drawer root or reject events outside that root.

### S5. A clean buffer with an old issue gets a false unsaved-changes dialog

- **Where:** `web/oss/src/components/Drives/editMode/state.ts:117`, `web/oss/src/components/Drives/editMode/components/DriveEditGuardModal.tsx:21`
- **What is wrong:** Any error or conflict activates the discard guard even when `draft === original`, but the modal always claims unsaved changes exist.
- **What breaks:** Revert the draft after a failed or conflicting save, then Cancel: the user is warned that clean content will be discarded.
- **Fix:** Guard only dirty buffers, or introduce issue-specific exit copy and behavior.

### S6. The tests avoid the two failing production seams

- **Where:** `web/oss/src/components/Drives/editMode/controller.test.ts:71`, `web/oss/src/components/Drives/editMode/controller.test.ts:178`, `web/oss/src/components/Drives/editMode/controller.test.ts:223`
- **What is wrong:** The file tests the pure save helper, package transport, and `useDriveEditGuard`; it never mounts `useDriveEditController` or `DriveFileEditor`.
- **What breaks:** Editor normalization, the persistent overwrite bypass, global shortcut scope, stale open snapshots, and multi-drawer contamination all pass the 70-test suite.
- **Fix:** Add tests for actual editor emissions and controller transitions, including conflict → revert → overwrite → edit → save and two simultaneous drawer scopes.

## Structure and naming

### N1. The controller file is four unrelated boundaries joined together

- **Where:** `web/oss/src/components/Drives/editMode/useDriveEditController.ts:73`, `web/oss/src/components/Drives/editMode/useDriveEditController.ts:164`, `web/oss/src/components/Drives/editMode/useDriveEditController.ts:207`, `web/oss/src/components/Drives/editMode/useDriveEditController.ts:355`, `web/oss/src/components/Drives/editMode/useDriveEditController.ts:470`
- **What is wrong:** One file owns availability queries, save mutation orchestration, DOM focusing, global shortcuts, unload handling, transient confirmation timing, shell navigation, drive swapping, and remote reload.
- **What breaks:** Reload errors already have to impersonate save failures, and controller behavior remains largely untestable without mounting the entire composition root.
- **Fix:** Separate the edit-session controller, shell navigation guard, and reload operation; replace the DOM selector with an editor ref/focus callback.

### N2. Reload errors abuse the save state machine

- **Where:** `web/oss/src/components/Drives/editMode/useDriveEditController.ts:490`, `web/oss/src/components/Drives/editMode/useDriveEditController.ts:502`
- **What is wrong:** A failed read calls `startEditSaveAtom` followed by `editSaveFailedAtom` solely to manufacture an error issue.
- **What breaks:** Request identity and `saving` no longer describe writes, making later concurrency changes unsafe and tests misleading.
- **Fix:** Add an honest reload-error action or a general `setEditIssueAtom`.

### N3. The facets read model is partially dead and causes broad subscriptions

- **Where:** `web/oss/src/components/Drives/editMode/state.ts:53`, `web/oss/src/components/Drives/editMode/state.ts:65`, `web/oss/src/components/Drives/DriveExplorer.tsx:118`, `web/oss/src/components/Drives/editMode/useDriveEditController.ts:101`
- **What is wrong:** `mode`, `editorView`, and `guardOpen` have no production reader through this atom. The atom creates a new object for every draft update, while the controller also subscribes to the entire buffer.
- **What breaks:** Every keystroke rerenders the `DriveExplorer` composition root and recomputes tree/query/controller work unrelated to the changed text.
- **Fix:** Remove the unused facets and expose narrow `selectAtom` selectors with equality for editing, dirty, saving, issue, and dirty path.

### N4. Cache invalidation lives in a React upload hook and is project-wide

- **Where:** `web/oss/src/components/Drives/useMountUpload.ts:69`, `web/oss/src/components/Drives/editMode/api.ts:10`, `web/oss/src/components/Drives/editMode/api.ts:89`
- **What is wrong:** A supposedly non-React save module imports a hook module that itself imports React, upload transport, media code, and UI dependencies. The helper also hand-codes query-key strings and omits `mountId`.
- **What breaks:** Saving one file invalidates active listings for every mount in the project and couples the edit save bundle to the upload module’s dependency graph.
- **Fix:** Move the helper beside the canonical mount query keys, accept `mountId`, and invalidate the four same-mount prefixes only.

### N5. `mode: "markdown"` lies about the editor mode

- **Where:** `web/oss/src/components/Drives/editMode/state.ts:28`, `web/oss/src/components/Drives/editMode/model.ts:45`, `web/oss/src/components/Drives/editMode/components/DriveFileEditor.tsx:40`
- **What is wrong:** Every file uses `codeOnly`; `"markdown"` means only “offer rendered preview.”
- **What breaks:** A later caller can reasonably use `mode` to configure the editor and accidentally reintroduce rich-mode serialization.
- **Fix:** Rename it to `supportsMarkdownPreview` or a similarly literal capability.

### N6. Dirty state has both a global atom channel and a drilled prop channel

- **Where:** `web/oss/src/components/Drives/DriveExplorer.tsx:340`, `web/oss/src/components/Drives/DriveTreeList.tsx:31`, `web/oss/src/components/Drives/DriveTreeList.tsx:137`, `web/oss/src/components/Drives/DriveTreeRow.tsx:20`
- **What is wrong:** Feature state is global for banners/editor/controller but is threaded through `DriveExplorer → DriveTreeList → TreeRow` for the row marker.
- **What breaks:** Scoping the buffer correctly now requires repairing two independent state-delivery mechanisms.
- **Fix:** Let `DriveTreeList` read a drawer-scoped dirty-path selector and pass only the row-local boolean to `TreeRow`.

### N7. Package transport tests are owned by the app feature

- **Where:** `web/oss/src/components/Drives/editMode/controller.test.ts:178`, `web/packages/agenta-entities/src/session/api/api.ts:694`
- **What is wrong:** The `@agenta/entities/session` write API is tested only from an app-level file named `controller.test.ts`.
- **What breaks:** The package’s own test suite does not protect its public transport contract, and the app test mixes three ownership layers.
- **Fix:** Move the transport test under `web/packages/agenta-entities/tests/unit/` and split the app tests into `api.test.ts`, guard tests, and actual controller tests.

## Non-blocking nits

- `web/oss/src/components/Drives/editMode/components/DriveEditBanner.tsx:25` blindly appends a period to backend messages, producing doubled punctuation.
- `web/oss/src/components/Drives/editMode/model.ts:6` exports a mutable `Set`; expose it as `ReadonlySet` or keep it module-private.
- `docs/design/file-drawer-edit-mode/status.md:10` says no implementation or tests exist, contradicting the implementation checkpoint at `status.md:163`.

## Questions the author must answer

- `web/oss/src/components/Drives/DriveExplorer.tsx:221` — Why is permission to edit coupled to the upload feature flag instead of an edit-specific capability?
- `web/oss/src/components/Drives/editMode/components/DriveEditGuardModal.tsx:19` — Who approved omitting the authoritative Save-and-continue action, and how is interrupted navigation supposed to complete after saving?
- `web/oss/src/components/Drives/DriveHeader.tsx:313` — Who approved disabling Cancel during saving despite the authoritative interaction requiring it to remain live?
- `web/oss/src/components/Drives/editMode/components/DriveFileEditor.tsx:59` — What evidence confirms `autoFocus` places the caret at the start rather than merely focusing the editor?
- `docs/design/file-drawer-edit-mode/status.md:177` — Why is this being considered pre-merge-ready when byte round-trip, conflict, guard-route, caret, and theme QA are still unrun?
