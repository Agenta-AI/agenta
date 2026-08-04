# Implementation review — file drawer edit mode

**Reviewer:** Claude (senior frontend pass)
**Date:** 2026-08-04
**Diff reviewed:** `git diff origin/release/v0.109.0...HEAD` (commits `af1d33c29a`, `2d7220ae5b`, `8301888ee8`)
**Verified:** `npx vitest run src/components/Drives` — 70 tests, 4 files, all pass.

The shape of the thing is right. The reducer is genuinely pure and genuinely tested, the
request-id discipline is correct, the four identity fields are carried through to the write,
the pre-write listing check fails closed, and `codeOnly` really is used for every kind so the
byte-fidelity argument holds. Every defect below is in the seams between the reducer and the
rest of the app, not in the reducer.

Findings are ranked most severe first.

---

## 1. The buffer outlives the drawer — nothing clears it on deactivate or unmount

**Files:** `web/oss/src/components/Drives/editMode/useDriveEditController.ts:312-325`
(controller unmount effect), `:386-393` (the guard's `!active` branch),
`web/oss/src/components/Drives/FilesDrawer.tsx:537-548`

`driveEditBufferAtom` is module-level by design, but nothing ever clears it except a user
action routed through the guard. The controller's unmount effect aborts the in-flight save and
clears the "Saved" timer; it does not touch the buffer. `useDriveEditGuard` has no cleanup at
all, and its `!active` branch explicitly *skips* resetting when a buffer exists. So any route to
`open === false` that does not go through `guardedClose` orphans the buffer.

Those routes exist. `SessionFilesDrawer.tsx:41` computes
`open = gridOpen || quickLook != null || staged.length > 0` from three atoms that
`RuntimeLens`, `ContextRail`, and `DriveFileCard` all write; and `SessionFilesDrawer` is mounted
per session by `AgentConversation`, so a session switch unmounts the host outright.

**Failure scenario.** In session A, open the Files drawer, click Edit on `INDEX.md`, type one
character. Switch to session B in the sidebar. `AgentConversation`(A) unmounts, the drawer
never calls `onClose`, and the dirty buffer stays in the module atom. Now open the Files drawer
in session B. `facets.editing` is `true`, so `DriveExplorer` replaces `DriveToolbar` with
`DriveEditBar`, `DriveTreePane` renders `inert`, and `DriveHeader` shows Cancel/Save — but
`DriveFilePreview:57-62` refuses to render `DriveFileEditor` because `targetMountId`/`targetPath`
don't match session B's mount, so there is no editor on screen. Search and the origin filter are
gone, the tree is dead, and `openEditBufferAtom:80` early-returns so Edit does nothing.
Escape → onCancel → the discard modal names a file from another session.

Two smaller consequences of the same root cause: `DriveEditBanner` (rendered unconditionally in
`DriveExplorer`) will show session A's conflict banner in session B's drawer; and if two
sessions' drawers are open at once (antd Tabs keeps inactive panes mounted), two
`useDriveEditController` instances register competing global `keydown` handlers over one shared
buffer.

**Fix direction:** clear the buffer when the guard goes inactive with no pending navigation, or
scope the atom to the drawer instance and let the drive-swap case be handled by the held drive.

---

## 2. "Reload from disk" silently does nothing if the user types during the fetch

**File:** `web/oss/src/components/Drives/editMode/useDriveEditController.ts:456-498`

`canAdoptReload()` requires `live.draft === discardedDraft`. Between `resolveNavigation("discard")`
and the `fetchQuery` resolving, the buffer is `saveStatus: "idle"` and the editor is fully
enabled — `DriveFileEditor` only disables on `saveStatus === "saving"` — and nothing renders a
spinner or a pending state. A single keystroke in that window makes `canAdoptReload()` false, and
both the `.then` and the `.catch` return without touching state.

**Failure scenario.** Agent writes the file underneath you. Conflict banner appears. Click
"Reload from disk" → the discard modal → Discard. The read takes 400 ms on a cold mount. You
type one character while waiting. The read lands, `canAdoptReload()` fails, and the function
returns. The banner still shows Reload / Overwrite, the buffer still holds your old content, and
there is no indication the reload was dropped. Click Reload again and you can hit the same window
again.

---

## 3. Reload and a missing-file conflict can permanently disarm conflict detection

**Files:** `web/oss/src/components/Drives/editMode/useDriveEditController.ts:180-181` and `:495`,
`web/oss/src/components/Drives/editMode/model.ts:86`

`conflictFromListing` returns `null` (proceed) whenever `baseMtime == null`. That degradation is
documented in the plan for the case where the store omits mtime, but two code paths *manufacture*
a null baseline for a buffer that had a good one:

- `:495` — `const mtime = current.issue?.kind === "conflict" ? current.issue.theirMtime : null`.
  For `reason: "missing"` the conflict carries `theirMtime: null` (`model.ts:84`), so a successful
  reload after a missing-then-recreated file leaves `baseMtime: null` and every subsequent save
  from that buffer is an unconditional overwrite with no check.
- `:180-181` — `listingQuery.data.find(...)?.mtime ?? null` opens a buffer with a null baseline
  whenever the file is absent from the parent listing (e.g. a gitignored file opened while the
  `include_gitignored` variant in the cache says otherwise).

Also at `:495`: even in the `changed` case the new baseline is the mtime observed *at conflict
detection time*, not the mtime of the bytes actually fetched a moment later. If the agent wrote
again in between, the buffer now holds content newer than its own baseline.

**Failure scenario.** Agent deletes `notes.md` while you edit it; you save; conflict `missing`.
Agent recreates it. You click Reload → Discard; the read now succeeds, `replaceBufferFromRemoteAtom`
sets `baseMtime: null`. You keep editing for ten minutes while the agent writes the file three
more times. Every save you make overwrites all of it, and the conflict banner never appears again
for that buffer.

---

## 4. Unmount aborts the PUT and reports failure for a write that may have landed

**File:** `web/oss/src/components/Drives/editMode/useDriveEditController.ts:312-325`

The cleanup calls `controller.abort()` and then writes
`editSaveFailedAtom({message: "Save was interrupted"})`. Aborting the client request proves
nothing about the server — the plan says exactly this at §2 and then the implementation does it
anyway. Since the buffer survives unmount (finding 1), the user comes back to a dirty buffer with
an error banner for a write that already succeeded.

**Failure scenario.** Save a 900 KB file on a slow mount. The host flips the drawer closed
(quick-look cleared from a chat card, or a session switch) while the PUT is in flight. The write
lands server-side. Reopen the drawer: the buffer is still there, banner says "Save was
interrupted. Your changes are still here." Click "Try again" → the pre-write check reads the mtime
*your own aborted write* produced, sees it differs from `baseMtime`, and reports "changed while
you were editing". Choosing "Reload from disk" now discards your edits in favour of your edits.

At minimum the interrupted-save message should say the outcome is unknown, and the buffer should
not be left in a state where the next check misattributes a self-write to the agent.

---

## 5. The tree is `inert` but looks completely live

**File:** `web/oss/src/components/Drives/DriveTreePane.tsx:65, 83`

The spec's `clean` note is "the tree stays visible but inert", and the prototype dims it
(`treeStyle` carries `opacity:0.45` while editing). The implementation sets `inert` and adds no
visual treatment whatsoever, so the tree renders at full contrast with hover styles intact.

**Failure scenario.** While editing, click another file in the tree. Nothing happens — no
selection, no discard dialog, no cursor change, no feedback of any kind, because `inert` swallows
the click before `edit.select` (the guarded path) can ever run. The user clicks three more times
and concludes the drawer is broken. The plan's "every exit routes through the guard" story
depends on tree clicks reaching `guardedSelect`; making the tree inert removes that route rather
than guarding it.

Either dim the tree (spec behaviour, at least signals "not now"), or drop `inert` on the rows and
let `guardedSelect` do its job.

---

## 6. Blocking on `saving` is silent everywhere, and the guard modal can deadlock for 30 s

**Files:** `web/oss/src/components/Drives/editMode/useDriveEditController.ts:268` and `:427`,
`web/oss/src/components/Drives/editMode/components/DriveEditGuardModal.tsx:26-29`

`onCancel` and `guardedClose` both `return` early while `saveStatus === "saving"` with no
feedback. The Escape handler `preventDefault()`s first, so Escape is swallowed too. With
`timeoutInSeconds: 30` on the write, a hung mount means the drawer's X, the mask, and Escape are
all dead for half a minute with nothing on screen explaining why.

Worse: the drive-swap effect (`:408-419`) fires regardless of save status, so it can open the
guard modal *during* a save — and that modal has `closable={false}`, `maskClosable={false}`, and
both buttons disabled while saving. There is no way out of it until the write settles.

---

## 7. Every keystroke re-renders the entire drawer

**Files:** `web/oss/src/components/Drives/editMode/useDriveEditController.ts:101-102, 373`,
`web/oss/src/components/Drives/editMode/components/DriveFileEditor.tsx:56`

`useDriveEditGuard` (in `FilesDrawer`) and `useDriveEditController` (in `DriveExplorer`) both
`useAtomValue(driveEditBufferAtom)`. `setEditDraftAtom` produces a new buffer object per
character, and `disableDebounce` (correctly required for the guard) means one write per character.
So each keystroke re-renders `FilesDrawer`, which recreates the `<DriveExplorer>` element, which
re-renders the header, the toolbar row, the virtualized tree list, and the preview.

**Failure scenario.** Open a mount with a few thousand files (the tree the drawer is built for),
edit a `.md`, and hold down a key. Every character walks `flatRows` and re-renders the tree list.
`FilesDrawer` needs only `pendingNavigation` / `displayPath` / `saveStatus`; the controller needs
only `displayPath` and `saveStatus` outside `onSave`. Selecting those narrowly (or reading the
draft only inside `DriveFileEditor`) removes the whole class.

---

## 8. Availability reports a directory-listing failure as an unreadable file

**File:** `web/oss/src/components/Drives/editMode/useDriveEditController.ts:138-145`

When the content loaded fine but the parent `mountDirQueryFamily` is pending or returned `null`,
availability collapses to `"loading"` / `"unreadable"`, and `DriveHeader.tsx:271-277` renders the
tooltip "This file couldn't be read".

**Failure scenario.** A folder listing 404s or times out (the `git_aware` listing does fail on
some mounts — `DriveHeader` already has a `partialErrored` path for exactly this). The file
renders perfectly in the preview, and Edit is greyed out claiming the file can't be read. The
user has no way to connect the message to the real cause.

---

## 9. The size-cap copy is hard-coded away from the constant it describes

**File:** `web/oss/src/components/Drives/DriveHeader.tsx:275`

`"Files larger than 1.5 MB can’t be edited"` duplicates `TEXT_CAP` (`driveKinds.ts:22`), which
this PR deliberately moved into one place so the cap has one definition. Change `TEXT_CAP` and the
tooltip lies. Derive the string from the constant (`humanSize` is already imported in
`DriveHeader`).

---

## 10. The session-teardown notice is permanent, and the flag that hides it is what shows it

**Files:** `web/oss/src/components/Drives/editMode/components/DriveEditBar.tsx:42-46`,
`web/oss/src/components/Drives/editMode/components/DriveFileEditor.tsx:18-24`

`teardownWarned` means "we have already warned"; the bar renders the notice *while* it is true. So
the notice appears on the first keystroke and then never leaves for the life of the buffer, which
is the opposite of the plan's "shows a one-line inline notice and `markTeardownWarnedAtom` fires so
it does not repeat". It works, but the next reader will invert it.

Related: the notice is squeezed onto the same flex row as the language chip and the right-aligned
hint (`Esc to cancel · filters resume after saving`, itself invented copy — the filters also
resume after Cancel). At the drawer's normal width, three text spans plus a segmented control on
one 44 px row will collide before they wrap.

---

## 11. Reload errors are rendered by pushing the save state machine through a fake save

**File:** `web/oss/src/components/Drives/editMode/useDriveEditController.ts:491-492, 502-503`

`startSave(requestId)` followed immediately by `saveFailed({requestId, ...})` is used purely to get
an error into the `issue` slot. React batches the two writes inside the promise callback so nothing
flashes today, but it means a reload failure moves `saveStatus` to `"saving"`, mints an
`inflightRequestId` that no request owns, and clears `skipConflictCheckOnce` as a side effect. One
`setIssueAtom` action would be honest and would not couple reload errors to the save reducer.

---

## 12. `saveDriveFile` hands the save's abort signal to a shared directory query

**File:** `web/oss/src/components/Drives/editMode/api.ts:61-69`

`abortSignal: signal ?? querySignal` overrides react-query's own signal with the save's. The
pre-write `fetchQuery` writes into `mountDirQueryKey(...)` — the exact key the tree's
`mountDirQueryFamily` observes. Aborting the save (unmount, or a second `onSave`) therefore
cancels a fetch that another live observer is waiting on. Prefer `querySignal` and let react-query
own cancellation, or chain the two signals.

---

## 13. Test quality: the controller — the risky half — is never mounted

**File:** `web/oss/src/components/Drives/editMode/controller.test.ts`

`state.test.ts` (20 tests) and `model.test.ts` (31 tests) are genuinely good: the request-id
no-ops, the one-issue-slot rule, the reload-keeps-the-buffer rule, and the full availability matrix
are all covered. But `controller.test.ts` exercises only `saveDriveFile` (a pure function) and
`useDriveEditGuard`. **`useDriveEditController` is never rendered in any test.** Untested, in
descending risk:

- the key bindings (Escape / ⌘S / ⌘E), including the `pendingNavigation` early-return that keeps
  Escape from reaching the drawer while the modal is open
- the unmount abort + `editSaveFailedAtom` path (finding 4)
- `beforeunload` registration and, more to the point, its *de*registration
- `guardedSelect` and the `path === selectedPath` short-circuit
- `onSave`'s request-id plumbing through the real `saveDriveFile` (state.test.ts covers the atoms,
  which the plan's list item "a late success from file A does not mutate a buffer for file B"
  already had; the controller wiring is the part that could get it wrong)
- the "Saved" timer and `justSavedPath === selectedPath`

Two cheap gaps in `saveDriveFile`'s own tests as well: no test that a `null` listing fails closed
(`api.ts:72-74`, the fail-closed behaviour the whole design rests on), and no test that
`skipConflictCheck: true` skips the directory fetch entirely (that is the Overwrite contract).

---

## Spec fidelity — states not implemented as written

Documented deviations from `status.md` (not defects, listed so QA does not re-raise them): Cancel
is disabled during a save rather than aborting it (`saving`); "View diff" is absent from the
conflict banner (`conflict`); "Save and continue" is absent from the guard (`confirm`); there is no
status footer.

Undocumented gaps:

- **`clean`** — "the tree stays visible but inert" is implemented without the spec's dimming
  (finding 5). "Focus lands in the editor with the cursor at the start of the document" is
  unverified: `autoFocus` mounts Lexical's `AutoFocusPlugin`, which makes no claim about caret
  position. The plan flagged this as a QA item; it is still open.
- **`saved`** — "Header size chip and tree row update from the write response" is done by
  invalidating four listing roots instead, so there is a refetch round trip where the spec wanted
  none. `MountFileWrittenResponse` does carry `size`, and `writeMountFile` already returns it, but
  `saveDriveFile:90` throws it away at the call site. Acceptable, worth noting.
- **`error`** — the banner reads `${message}. Your changes are still here.` where `message` is a
  raw Fern/axios error string (`api.ts:719-722` in the package). "Request failed with status code
  403. Your changes are still here." is what a permission failure will actually render.

## Repo conventions

Clean overall. Checked and passing: no `@agenta/sdk` root-barrel import (the Fern call sits in
`agenta-entities/session/api/api.ts` beside `readMountFile` and reaches the client through
`./client`); zod validation at the boundary via `safeParseWithLogging`; `{queryParams}` not axios
`params`; semantic antd tokens throughout the new components with no raw hex, no inline `style`,
no CSS-in-JS; comments are one line each; antd imports confined to `DriveEditBar` and
`DriveEditBanner` as the plan promised, with `EnhancedModal` used for the guard; the three
`CopyButton size="small"` lines are untouched. `inert={true}` is valid — this app is on React 19.

Two nits: `driveKinds.ts` now exports `CODE_LANGS` solely so a test can iterate it, which is a
test-only widening of a module's public surface; and `renderers.tsx` both re-exports `TEXT_CAP`
and imports it, so there are now two import paths for one constant.
