# Status

**Updated:** 2026-08-04 (plan revised after the Codex review)
**Worktree:** `/home/mahmoud/code/agenta-2-editmode`
**Branch:** `feat/file-drawer-edit-mode`, based on `origin/release/v0.109.0`
**PR base when the time comes:** `release/v0.109.0`. Never `main`.

## Where the work is

Planning is complete. No implementation code has been written.

| Phase | State |
|---|---|
| Repo research | done, written up in `research.md` |
| Design spec read and reconciled with the code | done |
| Plan | done, in `plan.md` |
| Implementation | not started |
| Tests | not started |
| Live QA | not started |

The plan was rewritten after the Codex review (see the decision record below). The next session
starts at `plan.md` section 13, step 1.

## Decisions made and why

| Decision | Reason |
|---|---|
| Save through `mounts.uploadMountFile`, not `mounts.writeMountFile` | The generated `writeMountFile` sends no request body and would write zero bytes. Both methods reach the same `MountsService.write_file`. `research.md` correction 1. |
| Orthogonal facets, not the twelve spec names as a derived label | Six of the twelve are orthogonal to the other six, and `code` is a mode no label function can return. A first-match table loses information and its "one assertion per spec name" test is unwritable. |
| One module-level `driveEditBufferAtom`, not an atom family | The spec's rule is one buffer at a time; a single nullable value enforces it by type, needs no key in the action atoms, and releases its two ~1.5 MB strings on close instead of pinning them per mount forever. |
| Four distinct identity fields: `driveKey`, `targetMountId`, `targetPath`, `displayPath` | `agent-files/` folds a second mount into one presented tree (`useSessionDrive.ts:188-194`). Calling all four "mount id" and "path" guarantees a wrong query key or a write to the wrong mount. |
| `SharedEditor` + our own `EditorProvider`, not `SimpleSharedEditor` | `SimpleSharedEditor` detects JSON/YAML/HTML from the content and would flip a `.txt` file containing JSON into a JSON code editor. It also renders a competing header. |
| `codeOnly` for every editable kind, markdown included | Rich mode serializes the document and runs `stripBackslashEscapes` on every emission (`Editor.tsx:282-299`), and the first `SET_MARKDOWN_VIEW(true)` serializes the hydrated rich tree rather than injecting the file (`markdownPlugin.tsx:151-168`). Neither is byte-preserving. `codeOnly` also unmounts `MarkdownPlugin` entirely, so the whole markdown-view mechanism drops out. |
| `disabled` passed to `SharedEditor`, not only to `EditorProvider` | `SharedEditor.state` is visual only; `EditorInner` defaults `disabled` to false and calls `setEditable(!disabled)` (`Editor.tsx:455-457`), re-enabling a provider-disabled editor. |
| A successful save exits edit mode | The write response has no mtime, so a buffer left open has no trustworthy baseline: any mtime fetched afterwards may belong to an agent write that landed in between. Exiting means every baseline comes from a fresh read at Edit time. |
| One conflict trigger: the pre-write listing check. No grace window, no activity trigger | A grace window silently overwrites agent writes inside it, and "the next save catches it" is false when the next save falls in the same window. Its stated purpose does not exist either — a frontend save appends no file activity. The activity trigger resolves paths only against the full-listing cache the lazy drawer usually does not have (`fileActivity.ts:86-99`, `useLazyDriveTree.tsx:117-138`). |
| A missing directory entry is a conflict, not "no mtime, proceed" | The write is an unconditional `put_object`, so proceeding recreates a file the agent deleted. |
| Every save completion carries its request id | A save started against file A can settle after the drawer closed and file B opened. An `AbortController` neither proves the server did not write nor stops a queued completion. |
| `canUpload` is the writable-mount proxy, named `canEditMountFiles` | `mountSchema` has no read-only flag. It is a capability proxy, not proof the backend accepts the write, and the name should not claim otherwise. |
| Reuse `useMountUpload`'s four-root invalidation | The header prefers `drive.recents` over the tree node's size, and recents come from `files-latest`/`files-root`. A directory-only invalidation leaves the visible size stale. |
| The write lives in `@agenta/entities/session` beside `readMountFile` | `web/AGENTS.md` puts the Fern call, the schema, and the validation together. Schema-in-package plus call-in-app is the worst of both. |
| The close guard is owned by `FilesDrawer`, not `DriveExplorer` | Antd receives the host `onClose` directly (`FilesDrawer.tsx:95-104`), so mask click and keyboard dismissal bypass anything wrapped further down. The guard modal also has to sit above the `key`-remount boundary. |
| `TEXT_CAP` moves to `driveKinds.ts`; `CODE_LANGS` is exported | The edit gate needs the cap without pulling in the Shiki/Markdown graph, and the language mapper's test cannot iterate a module-private map. |
| No backend change | Deliberate. Everything above is solvable on the client. |

## Codex review: what was accepted and what was rejected

Full review in `reviews/plan-review-codex.md`. Every claim below was re-verified against the code
before the plan changed. The plan body carries the outcome, not the argument.

### Accepted (the plan changed)

| # | Finding | Change |
|---|---|---|
| 1.1 | `state="readOnly"` is visual; the editor stays editable during a save | `disabled` now goes on `SharedEditor` too |
| 1.2 | Rich-mode markdown is not byte-preserving | `codeOnly` for every kind; the synchronizer, `SET_MARKDOWN_VIEW`, and `markdownViewAtom` are gone |
| 1.3 | `initialValue`/`value` do not behave as the plan described | The buffer owns original and draft; the editor's props are outputs |
| 1.4, 2.5, 2.9 | No save snapshot, no request identity | `bufferId` + `inflightRequestId`; mismatched completions are no-ops. The "typed during save" branch is unreachable because the editor is genuinely disabled |
| 1.8 | `autoFocus` does not put the caret at the start | Stated as unverified, with the fallback plugin named |
| 1.10 | The language test cannot import `CODE_LANGS` | It is exported |
| 1.11 | `DiffView` is unsafe even for a mid-edit `.json` | Diff cut from this PR; when it lands it uses `computeTextDiffLines` for every kind |
| 2.1 | No loaded/failed state for the original bytes | `driveEditAvailability` gained `loading` and `unreadable` |
| 2.2 | The family key is not the write mount for `agent-files/` | Four distinct identity fields |
| 2.3, 2.14 | Action atoms cannot select a family member; the family retains large buffers | A single atom |
| 2.4 | `openedAt` referenced but never declared | Moot — the activity trigger is cut |
| 2.6 | "Pure atoms" that run UI effects | Actions return an intent; the controller executes it |
| 2.7 | Reload discards the buffer it then adopts into | Reload replaces the buffer in place and keeps it open |
| 2.10 | `saved → read` unspecified, timer unowned | Save exits edit mode; the "Saved" tag timer is owned by the controller hook |
| 2.11 | `AbortController` in the atom value | It lives in a hook ref, as `useMountUpload` already does |
| 2.12, 2.13 | The derived label is lossy and untestable | Replaced with orthogonal facets |
| 2.15 | The spec's session-teardown warning was missing | Section 9 |
| 3.1, 4.7 | Mask click and antd Escape bypass the guard | `FilesDrawer` owns the guarded close |
| 3.2 | `DriveTreeRow` cannot select a keyed atom | `DriveTreeList` takes `dirtyPath` and passes a boolean down |
| 3.3 | The controller signature lacks what it needs | Resolved mount/path, content state, `includeGitignored`, and a shell close continuation |
| 3.4 | Eleven more flat files | An `editMode/` directory with `model`/`state`/`api`/controller/`components` |
| 3.7 | `DriveTreePane` has no inert seam | An `interactive` prop that sets `inert` on the scroll container and the resize handle |
| 3.8, 3.9, O.1, O.4 | The import surface does not compile | The write moves into the session package; `mountDirQueryKey` is exported |
| 3.11 | `canUpload` documented as writability | Renamed `canEditMountFiles` and described as a proxy |
| 4.1, 4.2, 4.3, 4.5 | The grace window creates silent overwrites and false conflicts | Cut, together with the post-save baseline adoption it existed for |
| 4.4 | The activity trigger usually cannot resolve a path | Cut |
| 4.6 | A deleted file would be silently recreated | Missing entry is a conflict |
| 4.8 | A changed `initialPath` bypasses a wrapped `select` | `FilesDrawer` holds it while dirty |
| 4.9 | A drive swap remounts the editor | The buffer survives in the module atom; the guard renders above the remount boundary |
| 4.10 | Drag spring-navigation bypasses the wrapped consumers | `enabled: canUpload && !editing` on the drop hook |
| 4.12 | The pre-write query could hit the wrong listing variant | `includeGitignored` is in the key |
| 4.17 | `content.length` is not a byte count | `size` is a required number in the schema |
| 4.18 | A stale or unknown listing size bypasses the cap | Re-checked against the loaded string |
| 4.19, O.5 | Invalidation too narrow for the header | Reuse the upload path's four roots |
| O.6 | No accessibility requirements | Section 12 |
| O.7 | ⌘E omitted | In the controller's key bindings |
| O.10 | The plan's prose would leak into comments | Stated at the end of the plan |

### Cut from this PR (accepted, deferred)

Side-by-side conflict diff · agent-activity early conflict warning · Save-and-continue in the
guard · the editor status footer (language is already in the bar, `UTF-8` is misleading after
replacement decoding, and cursor position needs selection plumbing) · `{kind:"filter"}` in the
intent union (unreachable while the toolbar is replaced).

### Rejected

| Finding | Why |
|---|---|
| Cut the markdown preview pane | It is a spec requirement and costs a segmented control plus the `Markdown` component we already render. The only defect cited was an unverified cursor-preservation claim in the prose, which is now removed. |
| Cut the tree-row dirty dot | The spec asks for exactly two dirty affordances. The real objection — a keyed atom read from a virtualized row — is fixed by reading it once at the list. |
| Cut the "Saved" confirmation entirely | The objection was an unowned timer, not the confirmation. It is now one timer owned by the controller hook and cleared on unmount. |
| Split `banner` into separate `saveError` and `conflict` fields | The spec has one banner slot and says only one can ever show. Two fields make coexistence representable. Renamed to `issue` instead. |
| Rename to `getDriveEditAvailability` | The value renames were taken; the `get` prefix does not match this module (`resolveDriveFileKind`, `driveCodeLanguage`). |
| Add a `DriveEditBoundary` component layer | One controller hook plus the guarded close in `FilesDrawer` covers it. A wrapper component is indirection without a seam. |
| Cancel stays live and aborts the write (spec rule) | Aborting the client request does not prove the server did not write, and an ambiguous outcome is worse than waiting. Cancel is disabled during the write and the request carries a timeout, so nobody is trapped. Deliberate deviation from the spec. |
| Add component-level or visual theme tests | This repo has no such harness. Both themes stay a QA checklist item, now covering every new banner, tag, tooltip, and modal state rather than the happy path. |
| Specify copy ownership and localization | The Drives area is English-only throughout and there is no i18n system to hook into. Not this PR's problem to invent. |

## Open questions

None are blocking. Each has a chosen answer; these are the ones worth revisiting if the answer
turns out badly in QA.

1. **No modification time from the object store.** When `mtime` comes back null on either side,
   the pre-write check cannot fire and nothing protects the write. It is the only conflict
   trigger, so this is the one silent-overwrite path left. Not observed in the local stack;
   recorded so a report has somewhere to start.
2. **The conflict window is the write itself.** The pre-write check closes just before the PUT;
   an agent write landing between the check and the PUT is lost. Closing that needs a
   conditional write on the backend (an `If-Unmodified-Since`-style precondition), which is a
   cross-stack change and out of scope here.
3. **Caret position on open.** `autoFocus` mounts Lexical's `AutoFocusPlugin`, which does not
   promise the caret lands at the start of the document as the spec asks. Check it in QA; the
   fallback is a small select-start plugin via `editorProps.additionalCodePlugins`.
4. **UTF-8 replacement on read.** `read_file` decodes with `errors="replace"`
   (`api/oss/src/core/mounts/service.py:1461-1474`), so a text file containing invalid UTF-8
   loses those bytes on read and would lose them permanently on save. Not fixable on the client.
   It is part of why only text kinds are editable.

## Known gaps, deliberately out of scope

- **`.env.local` and other multi-dot config files are not editable.** `resolveDriveFileKind`
  returns `other` for them, which is the download card. Widening the resolver changes the
  read-only viewer for every host that uses it, so it does not belong in this PR. Worth a
  follow-up.
- **No new file, rename, or delete.** Creating files stays the upload path's job.
- **CSV edits as text, not as a table.** The spec puts `csv` among the editable text kinds and
  there is no cell editor here.
- **No rich-text markdown editing and no formatting controls.** Every editable kind uses
  `codeOnly`, so the spec's "formatting controls stay visible but disabled in preview" has
  nothing to disable. Byte fidelity beats a toolbar for a file editor.
- **The design prototype's `capped` state is broken.** `STATES` lists it but `NOTES` has no entry,
  so selecting it dereferences `undefined`, and the renderer treats everything except `read` and
  `locked` as editing, putting `capped` into the editing layout. Our reading — Edit rendered but
  disabled with a tooltip naming the cap — comes from the `locked` notes, which say it explicitly.
  Worth fixing in the prototype before anyone treats all twelve rendered states as authoritative.

## Coordination

- **PR #5643, the antd migration**, targets `main` and lands soon. It touches three lines under
  `Drives/`, all `CopyButton size="small"` becoming `size="icon-sm"`, in `DriveFilePreview.tsx`,
  `DriveHeader.tsx`, and `FolderView.tsx`. Do not touch those lines. Do not rebase onto or merge
  that branch. The post-merge fixup here is two `import ... from "antd"` lines in two new files
  (`plan.md` section 11).
- **Do not push, do not open a PR, do not merge from this worktree.** The orchestrator does that.
- Never touch `/home/mahmoud/code/agenta-2`. A release is running there.

## Implementation checkpoint — 2026-08-04

Build-order steps 1–10 and 12 are implemented. The Fern multipart write boundary, Jotai buffer
state machine, conflict-safe save path, SharedEditor surface, drawer/header/tree wiring, guarded
navigation, markdown preview, session warning, and focused unit tests are complete.

Validation from `web/oss`:

- `npx vitest run src/components/Drives` — 4 files passed, 70 tests passed
- `npx tsc --noEmit` — passed with no errors
- `pnpm lint-fix` from `web` — passed; the existing React Compiler warnings remain in
  `VirtualTileGrid.tsx` and `useDriveTreeViewport.ts`
- semantic-token audit — no new raw colors, inline styles, CSS-in-JS, or replacement editor

Live backend verification and browser QA remain unrun because this worktree has no local stack or
browser. The five-extension byte round-trip, both themes, caret placement, and every interactive
guard route remain in the live QA checklist below.

## Live QA to run before calling it done

From `CONTEXT.md`: edit and save `.txt`, `.csv`, `.md`, `.env`, and `.json`. For each, confirm the
bytes round-trip without reformatting and the agent sees the change on its next tool call. A
markdown file containing backslash escapes, a trailing newline, and a blank final line is the
sharpest byte-fidelity case — check it explicitly.

Then:

- exercise the guard from every route in `plan.md` section 2: Cancel, Escape, the header close,
  the drawer mask, a tree selection, a chat link changing `initialPath`, drag spring-navigation,
  and browser unload
- force a conflict by having the agent write to an open file, and a `missing` conflict by having
  it delete one
- check the caret lands at the start of the document on open
- check both light and dark themes for every new state, not only the editor: the error banner,
  the conflict banner, the disabled Edit tooltip, the saving spinner, the Unsaved and Saved tags,
  and the guard modal

## Simplification pass (2026-08-04)

Behaviour-preserving cleanups over the two implementation commits. Unit tests (70) and
`pnpm type-check` green before and after; `pnpm lint-fix` clean.

Applied:

- `parentOf` (`driveTreeView.ts`) replaces the new `parentDirectory` in `editMode/api.ts`
  and the inline `lastIndexOf("/")` slice in the controller. One parent-path helper in the
  module, not three.
- `requestNavigationAtom` / `resolveNavigationAtom` return `NavigationIntent | null`
  instead of `{run: intent | null}`. The wrapper existed at six call sites and bought
  nothing; the `?.kind === "close"` checks it forced were tautological.
- `saveDriveFile`'s injected `invalidateListings` dependency dropped — no test ever
  overrode it. `queryDir` and `writeFile` (the two seams tests actually use) stay.
- `DriveEditController.onRetry` removed; it was an alias for `onSave`. `DriveEditBanner`
  takes `onRetry={edit.onSave}`.
- `DriveExplorer` passes `edit={edit}` instead of re-listing nine fields, and `DriveHeader`
  types the prop as `Pick<DriveEditController, …>` so the field list lives in one place.
- The Edit button in `DriveHeader` was written twice (enabled / disabled-with-tooltip).
  Now one `Button` with `disabled` plus an `EDIT_DISABLED_REASON` lookup — antd renders no
  tooltip for the empty string, so the enabled case is unchanged.
- `useDriveDrop`'s new "reset when disabled" effect duplicated the existing `onEnd` body.
  Merged into the listener effect, which calls `onEnd()` on the `!enabled` path.
- `useDriveUploads` no longer passes `onUpload: … ? uploadIntoFolder : () => {}` — every
  `useDriveDrop` handler is now gated on `enabled`, so the noop was unreachable.
- `focusEditor` uses one attribute selector instead of `querySelectorAll` + `find`.
- `closeEditBufferAtom` deleted: no production caller. Tests set `driveEditBufferAtom` to
  `null` directly (it is a plain writable atom).
- Dropped the unused `includeGitignored` entry from `onEdit`'s dependency array.

Deliberately left alone:

- **`driveEditFacetsAtom`.** `mode`, `editorView`, and `guardOpen` have no production
  reader today (components read `buffer.mode` / `buffer.editorView` directly). It is the
  read model `plan.md` §2 specifies and `state.test.ts` asserts on, so trimming it would
  contradict a settled plan for no behavioural gain. Worth revisiting if it stays unused.
- **`DriveExplorer`'s second read of `editing` via `driveEditFacetsAtom`.** It exists to
  break a cycle: `useDriveUploads` produces `canUpload`, which the controller consumes, so
  the controller cannot be called before it.
- **The drive-swap hold** (`heldDrive`/`holdDrive`/`requestedDriveSwap`/`pendingDriveSwap`).
  More machinery than §2's table describes, but removing it changes what the user sees
  when the host swaps drives under an open dirty buffer.
- **`canAdoptReload()`'s nine-way check and the `startSave` + `saveFailed` pair used to
  surface a reload error.** Both are convoluted (the second abuses the save atoms to set an
  error issue), but the reload path has no unit test and the change is not risk-free.
  A `setEditIssueAtom` would be the honest fix; logged here rather than done blind.
- **`DriveEditBanner`'s two `Alert` branches.** Collapsing them into one `Alert` with three
  ternaries reads worse than the two explicit branches.

---

# Review triage — 2026-08-04 (orchestrated Codex fix pass, commit `ed64d2be0b`)

Two independent implementation reviews were run against `af1d33c29a`, `2d7220ae5b`,
`8301888ee8` and are preserved verbatim at
`docs/design/file-drawer-edit-mode/reviews/impl-review-claude.md` and
`.../impl-review-codex.md`. I triaged both against the source before briefing the fix run.
**25 findings accepted, 12 rejected.** Everything accepted landed in one commit.

## Accepted (deduped across the two reviews)

P1 — correctness, each with a regression test:

| # | Finding | Fix that landed |
|---|---|---|
| 1 | Editor is not byte-preserving (Codex B1) — `editorCodeUtils.ts:121,145` turns tabs into two spaces and `trimEnd()`s the document; `code/index.tsx:128` pretty-prints compact JSON on hydration | `DriveFileEditor` switched to `useNativeCodeNodes` (byte-preserving hydrate + `getTextContent()` serialize). New `DriveFileEditor.test.tsx` drives the real Lexical editor in jsdom over trailing newline / trailing spaces / literal tab / CRLF / non-ASCII / empty / compact JSON |
| 2 | Overwrite permanently disarms conflict detection (Codex B2) — `onSave` early-returns on `draft === original`, leaving `skipConflictCheckOnce` armed | The bypass is no longer buffer state; `save(skipConflictCheck)` takes it as an argument |
| 3 | Module-global buffer contaminates other drawers (Claude 1 / Codex B3) — a session switch unmounts the host without `onClose`, bricking the next drawer | Every consumer scoped through `ownedEditBufferAtomFamily(driveKey)`; a clean buffer is cleared on controller unmount, a dirty one survives but is invisible to other drives |
| 4 | Unmount aborts the PUT and reports a failure for a write that may have landed (Claude 4) | AbortController removed entirely; the promise settles against the request-id discipline |
| 5 | The save's abort signal hijacked the shared directory query (Claude 12) | `abortSignal: querySignal` — react-query owns cancellation |
| 6 | A null `baseMtime` failed **open** (Claude 3) — two paths manufacture a null baseline, making every later save an unchecked overwrite | `conflictFromListing` tolerates a null baseline only when the listing entry also has no mtime; reload now re-reads the parent listing for a real mtime instead of reusing `theirMtime` |
| 7 | "Reload from disk" silently no-ops if the user types during the fetch (Claude 2) | Explicit `reloading` buffer state; draft writes rejected and the editor read-only while it is set; `canAdoptReload` no longer depends on the draft |

P2 — accepted: stale open snapshot via `isFetching` (Codex B4, cheap variant); known-oversized
files no longer downloaded (S1); UTF-8 byte cap instead of `String.length` (S2); guard only on
dirty so a clean buffer with a stale issue exits without a false dialog (S5); the
saving-blocks-navigation deadlock — drive-swap deferred while saving, "Keep editing" re-enabled,
blocked exits announced through the `aria-live` status (Claude 6); per-keystroke re-render of the
whole drawer killed with `selectAtom` families, dead facets deleted (Claude 7 / Codex N3);
shortcuts scoped to the explorer root (S4); a listing failure gets its own
`listing-unavailable` availability and honest tooltip (Claude 8); reload errors get
`editReloadFailedAtom`/`setEditIssueAtom` instead of faking a save (Claude 11 / Codex N2); the
inert tree is dimmed (Claude 5); `teardownWarned` → `showTeardownNotice`, edit-bar row wraps,
invented "filters resume after saving" copy dropped (Claude 10); Reload hidden for a `missing`
conflict (S3); size-cap tooltip derived from `TEXT_CAP` (Claude 9); and the controller is finally
mounted in tests — `useDriveEditController.test.tsx`, plus the two `saveDriveFile` gaps
(null listing fails closed, `skipConflictCheck` skips the fetch) (Claude 13 / Codex S6).

P3 — accepted: no double punctuation and product-copy-first error banner; `EDIT_KINDS` exposed as
`ReadonlySet`; `mode: "markdown"` renamed to `supportsMarkdownPreview`; `invalidateMountListings`
moved out of the React upload hook into `agenta-entities/session/state/mounts.ts` (Codex N4).

## Rejected, and why

1. **Per-drawer Jotai store/Provider** (Codex B3's prescribed fix) — the contamination is real,
   but `driveKey` scoping fixes it without restructuring the drawer's composition root.
2. **Splitting `useDriveEditController.ts` into three modules** (Codex N1) — churn with no
   behaviour change, and it would have invalidated the controller tests added in the same pass.
3. **The listing → content → listing retry loop** (Codex B4's prescribed fix) — the `isFetching`
   gate closes the observed window; the residual race is logged in `open-questions.md`.
4. **Removing the drilled `dirtyPath` prop for an atom in `DriveTreeList`/`TreeRow`** (Codex N6) —
   passing one boolean into a virtualized row is deliberate; an atom subscription per row is worse.
5. **Moving the `@agenta/entities/session` transport test into the package suite** (Codex N7) —
   real, but out of scope for a correctness pass.
6. **Using `size` from `MountFileWrittenResponse` instead of invalidating listings** (Claude's
   `saved` note) — the reviewer already scored it acceptable.
7. **`CODE_LANGS` being exported for a test** and 8. **`renderers.tsx` re-exporting `TEXT_CAP`**
   (Claude's conventions nits) — not worth the churn.
9. **The `autoFocus` caret-position claim** — a manual QA item, not a code finding.
10-12. **Codex's four "questions the author must answer"** (Cancel disabled during save, no
   "View diff", no "Save and continue", edit gated on the upload capability) — these are the
   deviations already documented above, not new findings.

## Verification (run independently of the fix agent)

- `npx vitest run src/components/Drives` from `web/oss` — **6 files, 92 tests, all pass**
  (was 4 files / 70 tests).
- `tsc -p oss/tsconfig.json --noEmit` — exit 0.
- `eslint src/components/Drives` — 0 errors, 2 pre-existing TanStack Virtual compiler warnings.
- `prettier --check` on all touched files — clean.
- Byte-fidelity test proven to bite: reverting only the two `useNativeCodeNodes` flags makes
  3 of the 7 round-trip cases fail (compact JSON, trailing newline, CRLF).

Still unverified and still owed: manual QA of the caret position under `autoFocus`, the theme
pass, and the guard-route walkthrough in a live stack.

## Final gate (2026-08-04)

Run from the worktree, against the full branch:

- `cd web/oss && pnpm exec vitest run src/components/Drives` — **6 files, 92 tests, all pass**.
- `cd web/oss && pnpm exec vitest run` (whole OSS suite) — **31 files, 241 tests, all pass**.
- `cd web/packages/agenta-entities && pnpm exec vitest run` — **67 files, 939 tests, all pass**
  (run because this branch touches the session package).
- `cd web && pnpm type-check` (oss + ee `tsc --noEmit`) — exit 0, no output.
- `cd web && pnpm lint-fix` — 11/11 turbo tasks successful, 0 errors, no files reformatted.
  The only warnings are the two pre-existing `react-hooks/incompatible-library` TanStack
  Virtual warnings in `VirtualTileGrid.tsx` and `useDriveTreeViewport.ts` — neither file is
  in this branch's diff.
- antd-migration collision check: `git diff origin/release/v0.109.0...HEAD --
  web/oss/src/components/Drives/` contains **no** line mentioning `CopyButton`.
  `FolderView.tsx` is untouched entirely; the `CopyButton size="small"` lines in
  `DriveFilePreview.tsx:121`, `DriveHeader.tsx:251` and `FolderView.tsx:181` are unchanged.
- Working tree clean at `65d9821717` + the qa.md commit. `web/oss/test-results/junit.xml` is a
  tracked vitest artifact that every run rewrites; it was restored rather than committed.

Live QA script for a human: `docs/design/file-drawer-edit-mode/qa.md`.
