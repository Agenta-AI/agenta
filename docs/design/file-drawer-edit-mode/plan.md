# Implementation plan

Read `research.md` first. Several of its corrections change the API this plan calls.

Everything lives under `web/oss/src/components/Drives/`. Paths below are relative to that
directory unless they start with `web/`.

## 1. What this PR ships

Open a text file in the Files drawer, click **Edit**, change it, save it back to the mount.
Every write is guarded by a pre-write modification-time check, every exit from a dirty buffer
is guarded by a dialog, and a failed write never loses a character.

Deliberately deferred, with the reason in `status.md`: the side-by-side conflict diff, the
agent-activity early conflict warning, Save-and-continue from the guard dialog, the editor
status footer, new/rename/delete, and `.env.local`-style multi-dot config files.

## 2. The state model

### One buffer, one atom

```ts
// editMode/state.ts
export const driveEditBufferAtom = atom<DriveEditBuffer | null>(null)
```

A single module-level atom, not an atom family. The spec's rule is "one file is editable at a
time — the drawer never holds two buffers", and a single nullable value enforces that with the
type rather than a check. It also means the action atoms need no key, and closing a buffer
releases its two potentially 1.5 MB strings instead of pinning them per mount for the module
lifetime.

Module-level (not provider-scoped) because the drawer uses `destroyOnClose`, and because
`FilesDrawer` remounts `DriveExplorer` under a new `key` when the host swaps one real drive for
another (`useDriveGeneration`, `FilesDrawer.tsx:35-56`). A buffer must survive both. The guard
dialog is therefore rendered by `FilesDrawer`, above that remount boundary.

### The record

```ts
export interface DriveEditBuffer {
    /** Identity for this open buffer. Late save completions are matched against it. */
    bufferId: string
    /** The drawer slot that opened it: the primary drive's mount id. */
    driveKey: string
    /** The mount actually written to. NOT driveKey — `agent-files/x` resolves to the agent mount. */
    targetMountId: string
    /** Path relative to targetMountId's root. The write target. */
    targetPath: string
    /** Presented path, including any `agent-files/` prefix. Breadcrumb, tree row, dialog copy. */
    displayPath: string
    scope: DriveScope
    /** Bytes as read when the buffer opened. Dirty is measured against this. */
    original: string
    draft: string
    /** mtime from the directory listing when the buffer opened; null when the store omitted it. */
    baseMtime: number | null
    mode: "markdown" | "code"
    language: CodeLanguage
    editorView: "source" | "preview"
    saveStatus: "idle" | "saving"
    /** Identity of the in-flight write. Completions that do not match are dropped. */
    inflightRequestId: string | null
    /** One banner slot. Setting either kind replaces the other. */
    issue: EditIssue | null
    pendingNavigation: NavigationIntent | null
    /** Set by Overwrite. Skips the pre-write check for exactly one attempt. */
    skipConflictCheckOnce: boolean
    /** The session-teardown notice has been shown for this buffer. */
    teardownWarned: boolean
}

export type EditIssue =
    | {kind: "error"; message: string}
    | {kind: "conflict"; reason: "changed" | "missing"; theirMtime: number | null}

export type NavigationIntent =
    | {kind: "cancel"}
    | {kind: "close"}
    | {kind: "select"; path: string | null}
    | {kind: "reload"}
```

Four separate names for what a looser model would call "mount id" and "path". `agent-files/`
paths fold a second mount into one presented tree (`useSessionDrive.ts:180-194`,
`resolveMount`), so the display path, the write path, the write mount, and the drawer slot are
four different values. Collapsing any two of them produces a wrong query key or a write to the
wrong mount.

Dirty is derived, never stored: `draft !== original`.

### No twelve-state label

The spec's twelve state names are a vocabulary for the design, not a variable. Six of them are
orthogonal to the other six (a buffer can be dirty and in preview and in conflict), so any
first-match table that flattens them loses information — and a `code` label that no
function can ever return makes a "one assertion per spec name" test impossible to write.

The state is read as orthogonal facets instead:

```ts
export interface DriveEditFacets {
    editing: boolean
    dirty: boolean
    saving: boolean
    mode: "markdown" | "code"
    editorView: "source" | "preview"
    issue: EditIssue | null
    guardOpen: boolean
}
```

Each spec state maps onto a combination of those, and each facet is independently testable.

### Actions

Every action atom is pure state manipulation with no I/O, so the whole reducer tests against a
bare `createStore()` with no React. Actions that need something to happen in the world **return
a value the controller interprets**; they never call into the app themselves.

| Atom | Effect |
|---|---|
| `openEditBufferAtom(input)` | no buffer → a clean buffer |
| `setEditDraftAtom(text)` | updates `draft`; ignored while `saveStatus === "saving"` |
| `setEditorViewAtom(view)` | swaps source/preview, nothing else |
| `requestNavigationAtom(intent)` | clean: clears the buffer, returns `{run: intent}`. Dirty or with an issue: sets `pendingNavigation`, returns `{run: null}` |
| `resolveNavigationAtom("keep")` | clears `pendingNavigation` |
| `resolveNavigationAtom("discard")` | returns the intent to run; clears the buffer unless the intent is `reload` |
| `startEditSaveAtom(requestId)` | `saveStatus = "saving"`, clears `issue` and `skipConflictCheckOnce` |
| `editSaveSucceededAtom(requestId)` | no-op unless `requestId === inflightRequestId`; otherwise clears the buffer |
| `editSaveFailedAtom({requestId, message})` | no-op on mismatch; otherwise `saveStatus = "idle"`, `issue = {kind:"error"}`, draft untouched |
| `markEditConflictAtom({requestId, reason, theirMtime})` | no-op on mismatch; sets the conflict issue |
| `overwriteNextSaveAtom()` | clears the issue, sets `skipConflictCheckOnce` |
| `replaceBufferFromRemoteAtom({content, mtime})` | replaces `original`, `draft`, `baseMtime`; clears the issue; buffer stays open and clean |
| `markTeardownWarnedAtom()` | sets `teardownWarned` |
| `closeEditBufferAtom()` | clears the buffer |

Two rules that are one line each in the reducer and remove whole classes of bug:

**Every completion carries the request id it belongs to.** A save started against file A can
settle after the drawer closed and a buffer for file B opened. Matching `inflightRequestId`
makes that completion a no-op instead of marking B saved or moving B's baseline. An
`AbortController` does not prevent this: aborting the client request does not prove the server
did not write, and a queued completion can still land.

**A successful save exits edit mode.** The write response carries no modification time
(`MountFileWrittenResponse` is `path` and `size` only), so a buffer that stays open after a save
has no trustworthy baseline: any mtime fetched afterwards might belong to an agent write that
landed in between, and adopting it would arm the next save to overwrite that agent write without
a conflict. Exiting means the baseline is always established by a fresh read at Edit time. The
header shows a transient "Saved" tag for about two seconds, owned by the controller hook and
cleared on unmount or on the next edit.

Because the editor is genuinely disabled during the write (section 5) and Cancel is disabled
with it, the draft cannot move while a save is in flight. The spec's "if the user has already
typed again during the write" branch is therefore unreachable and is not implemented.

### Exit routes that must run through the guard

| Route | Where it is intercepted |
|---|---|
| Cancel button | `DriveHeader` edit cluster → controller |
| Escape | drawer-level `keydown` in the controller |
| Drawer close: header button, mask click, antd Escape | `FilesDrawer` wraps the host `onClose` **before** giving it to `EnhancedDrawer`. Wrapping only the callback passed to `DriveHeader` leaves mask and keyboard dismissal unguarded — antd receives the raw callback (`FilesDrawer.tsx:95-104`, `EnhancedDrawer.tsx:71-80`) |
| Selecting another file or folder | `DriveExplorer` wraps `select` before the tree, breadcrumb, folder grid, and preview |
| A changed `initialPath` | `useDriveSelection` re-selects from its own effect (`useDriveSelection.ts:84-90`), which a wrapper around the returned `select` cannot intercept. `FilesDrawer` holds the incoming `initialPath` while a dirty buffer is open and passes the previous value down; Discard releases it |
| Drag spring-navigation | `useDriveDrop` calls `onNavigate` from a 700 ms timer (`useDriveDrop.ts:94-105`). Pass `enabled: canUpload && !editing` so drop and its timers are off entirely — CSS `pointer-events-none` does not stop a timer that has already started |
| Browser unload | `beforeunload` registered only while dirty. The browser shows its own dialog; ours cannot run there, so this route does not use `NavigationIntent` |
| Drive swap under an open drawer | The host changes `drive.mount.id`, `useDriveGeneration` bumps, and React replaces `DriveExplorer`. A child cannot stop its parent remounting it, so the buffer survives in the module atom and `FilesDrawer` shows the guard on the next mount. The buffer carries its own `targetMountId`, so Save still writes to the right place |

The spec's fifth route, changing a filter, is not reachable: the edit bar replaces the toolbar,
so search, origin, and the visibility toggles are unmounted while editing. No intent kind for it.

## 3. Files that change

### Package changes (`web/packages/agenta-entities/src/session/`)

- `core/schema.ts`: add `mountFileWrittenResponseSchema` — `{path: z.string(), size: z.number()}`.
  `size` is required. The backend always sends an integer, and falling back to `content.length`
  would report a UTF-16 character count as a byte count.
- `api/api.ts`: add `writeMountFile` beside the existing `readMountFile`. The write boundary
  belongs where the mount reads and their validation already live; splitting the schema into the
  package and the call into the app is the worst of both.
- `index.ts`: export `writeMountFile`, `mountFileWrittenResponseSchema`, and `mountDirQueryKey`.
  The last one exists in `state/mounts.ts:42` but is not in the barrel today, and the package
  exposes only the `./session` subpath, so the pre-write check cannot reach it otherwise.

### Existing Drives files

**`driveKinds.ts`**: move `TEXT_CAP` here from `renderers.tsx` and export it. This module is
deliberately React-free so light consumers can import it; the edit gate must not pull the Shiki
and Markdown graph in to read a number. Also export `CODE_LANGS` as a `Readonly<Record<...>>` so
the language mapper's test can iterate it — today it is module-private.

**`renderers.tsx`**: `export {TEXT_CAP} from "./driveKinds"` and import it from there for the
existing cap checks. One definition, both readers. No other change.

**`FilesDrawer.tsx`**: owns the guarded close, the held `initialPath`, and renders
`DriveEditGuardModal` above the `key`-remount boundary. This is the shell that antd actually
talks to, so it is the only place a close guard can be complete.

**`DriveHeader.tsx`**: one optional prop group.

```ts
edit?: {
    availability: DriveEditAvailability
    editing: boolean
    dirty: boolean
    saving: boolean
    justSaved: boolean
    onEdit: () => void
    onCancel: () => void
    onSave: () => void
}
```

1. In the browsing cluster, between the details toggle and `DriveFileDownloadButton`, render an
   Edit button when `availability === "enabled"`, or a disabled Edit button with an explanatory
   tooltip when it is `"too-large"`, `"loading"`, or `"unreadable"`. Render nothing when
   `"unavailable"`. Secondary style, never primary: Download stays the loudest action for a reader.
2. While editing, replace the whole right-hand cluster (upload, copy, details, download, overflow)
   with Cancel and Save. Save is `type="primary"`, disabled unless dirty, and shows the antd
   `loading` spinner reading "Saving" during the write. Cancel is disabled during the write.
3. Next to the origin `Tag`, an "Unsaved" `Tag` when dirty, or a success-toned "Saved" `Tag`
   while `justSaved`. Both reuse the already-imported `Tag`.
4. An `aria-live="polite"` region carrying the current status text (Saving, Saved, the error
   message, the conflict message), so the asynchronous state changes are announced.

Do not touch the `CopyButton size="small"` line. The antd migration branch changes it.

**`DriveToolbar.tsx`**: unchanged. `DriveExplorer` chooses between it and `DriveEditBar`.

**`DriveFilePreview.tsx`**: when a buffer is open for this file, render `DriveFileEditor` instead
of `DriveFileContentViewer`. The meta band above is unchanged. Do not touch its `CopyButton` line.

**`DriveTreePane.tsx`**: add an `interactive` prop (default true). When false it sets `inert` on
the tree scroll container and the resize handle and drops `onTreeKeyDown`. The pane has no such
seam today, and the resize handle is a sibling of the tree element, so opacity on the tree alone
would leave both keyboard focus and resizing live.

**`DriveTreeList.tsx` / `DriveTreeRow.tsx`**: `DriveTreeList` takes a `dirtyPath: string | null`
and passes a boolean to the matching row, which renders the dot. One subscription at the list,
not one per virtualized row — and `DriveTreeRow` receives no drive identity, so it could not
select a keyed atom member anyway.

**`useMountUpload.ts`**: export its `refreshListing` body as
`invalidateMountListings(queryClient, projectId)`. It invalidates `files`, `files-latest`,
`files-root`, and `files-dir` — every root the drawer's header, recents, and tree actually read.
The save reuses it rather than inventing a narrower policy that leaves the header size stale.

**`DriveExplorer.tsx`**: composition only.

- call `useDriveEditController(...)`
- swap `<DriveToolbar/>` for `<DriveEditBar/>` while editing
- pass the `edit` prop group to `DriveHeader` and `dirtyPath` to `DriveTreeList`
- pass the guarded `select` to the tree, breadcrumb, folder grid, and preview
- pass `enabled: canUpload && !editing` into `useDriveUploads`
- pass `interactive={!editing}` to `DriveTreePane`
- render `<DriveEditBanner/>` between the second header row and the body

### New files, under `editMode/`

| File | Contents | React? | antd? |
|---|---|---|---|
| `model.ts` | `EDIT_KINDS`, `driveEditAvailability`, `driveEditBufferMode`, `driveEditorLanguage`, `isEditDirty`, `conflictFromListing` | no | no |
| `state.ts` | `driveEditBufferAtom`, the facets selector, every action atom | no | no |
| `api.ts` | `saveDriveFile`: pre-write check, the package write call, cache seeding, invalidation | no | no |
| `useDriveEditController.ts` | The drawer-level controller, plus `useDriveEditGuard` for `FilesDrawer` | hook | no |
| `components/DriveEditBar.tsx` | Header row 2 while editing: "Editing" label, Source/Preview segmented for markdown, language chip for code, hint line, session-teardown notice | yes | `Segmented`, `Button`, `Tooltip` |
| `components/DriveFileEditor.tsx` | `SharedEditor` in an `EditorProvider`, plus the markdown preview pane | yes | no |
| `components/DriveEditBanner.tsx` | The one banner slot: error with Try again, conflict with Reload from disk / Overwrite | yes | `Alert`, `Button` |
| `components/DriveEditGuardModal.tsx` | Discard dialog, `EnhancedModal` from `@agenta/ui/components` | yes | no |
| `model.test.ts`, `state.test.ts`, `controller.test.ts` | see section 8 | no | no |

A directory rather than eleven more flat files in an already large module: `driveEdit.ts`,
`driveEditState.ts`, `driveEditSave.ts`, and `useDriveEdit.ts` are indistinguishable in an import
list and reveal no hierarchy.

## 4. The controller

```ts
useDriveEditController({
    driveKey,          // drive.mount?.id ?? ""
    resolveMountPath,  // (displayPath) => {mount, path} | null — folds agent-files/
    selectedPath,
    scope,
    canEditMountFiles,
    includeGitignored, // part of every directory query key
    select,
    close,
})
```

It owns everything the reducer cannot: reading the original bytes, resolving `baseMtime`,
running the save, executing returned navigation intents, the key bindings (⌘E to open, ⌘S to
save, Escape to exit), the `beforeunload` registration, the `AbortController` (in a ref, as
`useMountUpload` already does — not in the atom), and the "Saved" tag timer.

Opening a buffer requires all of:

- a resolved `{mount, path}` from the drive's own resolver, so the write target is right for
  `agent-files/`
- raw content that has actually loaded. `useDriveFileText` returns `{data, isPending}` and
  represents a failed read as non-pending `undefined` (`driveFileSource.tsx:63-84`), so
  `isPending` means loading and `!isPending && data === undefined` means unreadable. Edit is
  disabled in both cases with a tooltip saying which
- a length re-check against `TEXT_CAP` on the loaded string. The listing size can be stale or
  unknown, and `driveTree.ts` converts a null size to `0`, so the listing snapshot alone is not
  a cap
- `baseMtime` read from the raw directory listing for the file's parent
  (`mountDirQueryKey(projectId, targetMountId, parentDir, includeGitignored)`), not from the
  tree node — `DriveTreeNode` discards `mtime`

`canEditMountFiles` is derived from the drawer's existing `canUpload`
(`isAgentFileUploadsEnabled() && !explicitFiles && !!drive.mount`). It is a capability proxy, not
proof the backend will accept the write: `mountSchema` has no read-only flag and we do not invent
one. The name says "can edit", not "mount is writable".

## 5. The editor

### Every editable kind is `codeOnly`, including markdown

```tsx
const editorId = `drive-edit-${bufferId}`

<EditorProvider
    codeOnly
    language={language}
    enableTokens={false}
    showToolbar={false}
    disabled={saving}
    id={editorId}
>
    <SharedEditor
        id={editorId}
        editorType="borderless"
        state={saving ? "readOnly" : "filled"}
        disabled={saving}
        initialValue={original}
        value={draft}
        handleChange={onDraftChange}
        disableDebounce
        noProvider
        autoFocus
        editorProps={{
            codeOnly: true,
            language,
            noProvider: true,
            showToolbar: false,
            enableTokens: false,
        }}
        className={editorView === "preview" ? "hidden" : undefined}
    />
</EditorProvider>
```

**Markdown is edited as source through `codeOnly`, never through the rich-text markdown mode.**
This is a correctness requirement, not a preference. In rich mode the editor emits changes by
serializing the Lexical document and then running `stripBackslashEscapes`
(`Editor.tsx:282-299`), which removes every backslash that precedes another character
(`plugins/markdown/utils/textCleanup.ts:146-177`). Worse, the first `SET_MARKDOWN_VIEW(true)`
does not inject the original file text: it serializes the rich tree it hydrated
(`markdownPlugin.tsx:151-168`), so the file can be reformatted before the user types anything.
`ChatMessageEditor` is not a precedent here — it edits a semantic chat message and never promises
byte preservation.

`codeOnly` also means `MarkdownPlugin` is not mounted at all
(`plugins/index.tsx: singleLine || codeOnly ? null : <MarkdownPlugin/>`), so there is no
`SET_MARKDOWN_VIEW` command to pin, no `markdownViewAtom` to write, and no synchronizer
component. The whole markdown-view mechanism drops out of this feature.

**`disabled` goes on `SharedEditor`, not only on the provider.** `SharedEditor.state` only
changes container classes and cursor styling; editability comes from the `disabled` prop it
forwards to `Editor` (`SharedEditor.tsx:216-235`), which reaches `EditorInner`, where it defaults
to `false` and calls `editor.setEditable(!disabled)` (`Editor.tsx:455-457`). A provider-only
`disabled` is re-enabled by that inner effect and the user can type into a buffer mid-write.
`state="readOnly"` stays for the visual treatment.

**The buffer owns `original` and `draft`; the editor's props are outputs, not the source of
truth.** `SharedEditor` prefers `value` over `initialValue` for its controlled value
(`SharedEditor.tsx:71-80`), and in code mode the plugin seeds its initial content from
`value !== undefined ? value : initialValue` (`plugins/index.tsx:149-160`). So `initialValue`
is not a separate mount-time channel. Never infer the save baseline from it. Do not pass
`syncWithInitialValueChanges`: it would re-seed the buffer on a background refetch, which is the
overwrite this feature exists to prevent.

`disableDebounce` is required. The default is a 300 ms window (`SharedEditor.tsx:76-81`), which
would leave Save disabled for a third of a second after the first keystroke and let the guard
miss a change typed immediately before Escape.

`autoFocus` mounts Lexical's `AutoFocusPlugin`, which focuses but does not promise the caret is
at the start of the document. Verify that in QA; if the caret lands at the end, add a small
select-start plugin through `editorProps.additionalCodePlugins`.

### Markdown source and preview

The Source/Preview segmented in the edit bar sets `editorView`. In `preview` the `SharedEditor`
gets `className="hidden"` — `SharedEditor` merges the caller's className onto its outer node, so
the class reaches the right subtree — and we render the existing `Markdown` component from
`@/oss/components/AgentChatSlice/assets/markdown` over `draft`, inside the same scroll container
`TextBody` uses (`renderers.tsx:153-160`). Same component as the read view, so nothing shifts
between preview and viewing after save.

Keeping the editor mounted avoids a remount and preserves undo history. Whether the caret
position survives the round trip is untested and is not claimed; nothing in the code restores a
selection across the toggle.

Preview is offered only when `mode === "markdown"`. For `code` the bar shows the language chip
instead, so it does not reflow. The spec's "formatting controls stay visible but disabled in
preview" does not apply: `codeOnly` has no rich-text toolbar to disable.

### The language mapper

`driveEditorLanguage(path)` maps the Shiki id from `driveCodeLanguage(path)` into the six-value
`CodeLanguage` union (`plugins/code/types.ts`, see `research.md` correction 4):

```
json, yaml            -> "json" / "yaml"
python                -> "python"
javascript, jsx, mjs  -> "javascript"
typescript, tsx       -> "typescript"
everything else       -> "code"
```

`"code"` is the union's generic highlighter and is the honest answer for markdown, shell, Rust,
Go, CSV, plain text, and `.env`.

## 6. The save path

```ts
// packages/agenta-entities/src/session/api/api.ts
export async function writeMountFile({
    projectId, mountId, path, content, signal,
}): Promise<{ok: true; size: number} | {ok: false; message: string}>
```

- `uploadMountFile`, not the generated `writeMountFile`. The generated raw-body method sends no
  body and would truncate the file. Both endpoints reach the same `MountsService.write_file`,
  with the same `EDIT_MOUNTS` check and the same full `put_object` overwrite. `research.md`
  correction 1.
- The full mount-relative `path` in the query. `upload_mount_file` uses it verbatim unless it is
  empty or ends in `/` (`api/oss/src/apis/fastapi/mounts/utils.py:79-83`), so it overwrites
  exactly that object and the multipart filename is irrelevant.
- `projectScopedRequest(projectId, undefined, signal, 0)`. `maxRetries: 0`: a retried PUT after a
  timeout can land after the user has edited again.
- Not `callFern` — it turns every failure into `null` and the error banner needs the message.
  Aborts are rethrown.
- `safeParseWithLogging(mountFileWrittenResponseSchema, ...)` at the boundary.
- An explicit request timeout, so a hung mount surfaces as an error banner with the buffer intact
  rather than a permanently disabled Cancel.

### After a successful write

1. `queryClient.setQueryData(mountFileContentQueryKey(projectId, targetMountId, targetPath), draft)`
   — the drawer returns to the read view with the saved bytes already rendered, no refetch, no
   skeleton flash.
2. `invalidateMountListings(queryClient, projectId)` — the same four roots the upload path
   invalidates. The header prefers `drive.recents` over the tree node's size
   (`DriveExplorer.tsx:180-193`), and recents come from `files-latest`/`files-root`, so a
   directory-only invalidation leaves the visible size stale.

Do **not** call `revalidateSessionMountsAtom`: it invalidates every mount in the project plus
every cached body, which is right after an agent turn and far too wide for a one-file save.

## 7. Conflict detection

One trigger: the pre-write modification-time check. Before every write, unless
`skipConflictCheckOnce` is set:

1. `queryClient.fetchQuery` on
   `mountDirQueryKey(projectId, targetMountId, parentDir, includeGitignored)` with `staleTime: 0`,
   using the same fetcher `mountDirQueryFamily` uses. `includeGitignored` is part of the key; a
   check against the wrong listing variant would look at a listing the file is absent from.
2. **No entry for the path → conflict, `reason: "missing"`.** The agent deleted the file. Treating
   a missing entry as "no mtime to compare, proceed" would silently recreate a deleted file,
   because the write is an unconditional `put_object`.
3. Entry present, both mtimes non-null and different → conflict, `reason: "changed"`.
4. Entry present, either mtime null → cannot compare; proceed. A silent degradation, recorded in
   `status.md` rather than hidden.

There is no self-write grace window and no agent-activity trigger.

A grace window that suppresses the check for N seconds after a save is a correctness bug: an
agent write inside the window is overwritten silently, and the "next save catches it" claim is
false because the next save can fall inside the same window. Its stated purpose — stopping our
own invalidation from raising a conflict against our own bytes — does not exist either: file
activity is appended from detected agent tool calls, and a frontend save appends nothing
(`fileActivity.ts:75-139`). Exiting edit mode on save (section 2) removes the problem the window
was invented for.

The activity trigger is cut because it usually cannot fire. `fileActivity` resolves a tool path
only by scanning cached queries under the full-listing prefix `["mounts", "files", projectId]`
(`fileActivity.ts:86-99`), and the drawer loads per-directory `files-dir` queries, fetching the
full listing only while search is active (`useLazyDriveTree.tsx:117-138`). An open drawer
normally gets an entry with no `resolved` mount/path. It is worth adding later, once it can
resolve `files-dir` entries; it only ever made the warning arrive earlier, and the pre-write check
is what actually prevents data loss.

### The two ways out of a conflict

- **Reload from disk** — when dirty this routes through the guard with a `reload` intent; on
  Discard the content query is invalidated, refetched, and `replaceBufferFromRemoteAtom` swaps
  `original`, `draft`, and `baseMtime` in place. The buffer stays open and clean. It does not
  close the buffer and then adopt into it.
- **Overwrite** — `overwriteNextSaveAtom()` then save. The flag clears on the next
  `startEditSaveAtom`, so a second conflict is caught normally. The button copy says it
  overwrites.

Seeing what changed before choosing is deferred: the diff needs a fresh content read, a modal,
and its own async lifecycle, and `DiffView` cannot render it — its props are restricted to JSON
and YAML and its extension parses the strings before diffing, so a file that is mid-edit and not
yet valid JSON renders nothing (`DiffView.tsx:178-199`,
`plugins/code/extensions/diffHighlight.tsx:385-425,526-529`). When it lands it should use
`computeTextDiffLines` for every kind, including `.json`, because the product compares raw file
bytes, not parsed data structures.

## 8. Which files can be edited

```ts
// editMode/model.ts
export const EDIT_KINDS = new Set<DriveFileKind>([
    "markdown", "text", "code", "json", "csv", "html",
])

export type DriveEditAvailability =
    | "enabled" | "loading" | "unreadable" | "too-large" | "unavailable"

export function driveEditAvailability({kind, listingSize, contentLength, isPending, canEdit}) {
    if (!canEdit) return "unavailable"
    if (!EDIT_KINDS.has(kind)) return "unavailable"
    if (listingSize != null && listingSize > TEXT_CAP) return "too-large"
    if (isPending) return "loading"
    if (contentLength == null) return "unreadable"
    if (contentLength > TEXT_CAP) return "too-large"
    return "enabled"
}
```

`kind` comes from `resolveDriveFileKind(path)`. There is no second extension list anywhere in
this feature. `unavailable` renders no Edit button at all — a category is not a limit, and a
disabled Edit on every image would train people to ignore the button. The other three render it
disabled with a tooltip that says which.

### The five extensions the user will QA

| Extension | Kind | Buffer mode | Read view today | What editing does |
|---|---|---|---|---|
| `.txt` | `text` | `code`, language `code` | `TextBody`, a `<pre>` | plain source buffer, verbatim round trip |
| `.csv` | `csv` | `code`, language `code` | `CsvBody`, a parsed table | plain source buffer over the raw text; the table returns after save |
| `.md` | `markdown` | `code`, language `code` | `TextBody` rendering `Markdown` | raw markdown source, with a Preview pane using the same `Markdown` component |
| `.env` | `text` | `code`, language `code` | `TextBody`, a `<pre>` | same as `.txt` |
| `.json` | `json` | `code`, language `json` | `CodeBody`, pretty-printed | source buffer seeded from the **raw** content, not from the pretty print |

Three traps worth stating:

**`.json` must not be seeded from the read view.** `CodeBody` runs
`JSON.stringify(JSON.parse(content), null, 2)` before displaying (`renderers.tsx:178-186`).
Seeding from that reformats the whole file the moment the user changes one line. Seed from
`useDriveFileText`, which returns the raw string.

**`.csv` becomes text while editing.** The spec lists `csv` among the editable kinds and there is
no cell editor here. The table is a read view only. `csv` is not in `TEXT_KINDS` but the renderer
already applies `TEXT_CAP` to it (`renderers.tsx:585-638`), so the cap behaviour matches.

**`.env` works, `.env.local` does not.** `resolveDriveFileKind(".env")` returns `text` because
`/\.(txt|log|env)$/i` matches a leading dot. `.env.local` matches nothing and lands on `other`,
the download card. Widening the resolver would change the read-only viewer for every host, so it
stays out of this PR and is logged in `status.md`. `.env` is a dotfile and appears only with the
hidden-files toggle on, which is its default (`useDriveFilters.ts:16`).

`.html` is editable as a `code` buffer; `image`, `pdf`, `audio`, `video`, and `other` are
`unavailable`.

## 9. Session-scoped files warn on first edit

The spec's rules require it: a session's files can be torn down with the session. On the first
keystroke in a buffer whose `scope === "session"`, the edit bar shows a one-line inline notice and
`markTeardownWarnedAtom` fires so it does not repeat for that buffer. A line in the bar, not a
modal — it is a caveat, not a decision.

## 10. Test plan

Vitest, colocated, following `dropEntries.test.ts`. No snapshot tests of the rendered drawer.

### `model.test.ts`

- `resolveDriveFileKind` for `.txt`, `.csv`, `.md`, `.env`, `.json`, `agent-files/.env`,
  `.env.local`, `.png`, `.pdf`, `README`. Locks the dotfile behaviour the `.env` story rests on.
- `driveEditAvailability` across the matrix: every kind × `{under cap, exactly cap, over cap,
  null listing size}` × `{pending, loaded, unreadable}` × `{canEdit true/false}`. Assert
  `too-large` only ever appears for a kind in `EDIT_KINDS`, that a null listing size still gets
  capped once the content length is known, and that a failed read never reports `enabled`.
- `driveEditBufferMode`: `markdown` only for markdown extensions, `code` otherwise.
- `driveEditorLanguage`: every value in the now-exported `CODE_LANGS` maps into the six-value
  union; `.json`→`json`, `.yaml`→`yaml`, `.py`→`python`, `.sh`→`code`, `.md`→`code`.
- `isEditDirty`: differs, identical, identical after retyping, trailing-newline difference,
  empty original.
- `conflictFromListing`: entry missing → conflict; mtime changed → conflict; mtime equal → none;
  either mtime null → none.

### `state.test.ts` (bare `createStore()`, no React)

- open puts the machine in a clean buffer with Save disabled; one edit makes it dirty; editing
  back to the original text makes it clean again.
- `requestNavigationAtom` on a clean buffer returns the intent and clears the buffer; on a dirty
  buffer it returns nothing and sets `pendingNavigation`.
- `resolveNavigationAtom("keep")` clears `pendingNavigation` and touches nothing else.
- `resolveNavigationAtom("discard")` returns the intent; it clears the buffer for `close`,
  `cancel`, and `select`, and keeps it for `reload`.
- `setEditDraftAtom` is ignored while saving.
- a completion whose `requestId` does not match `inflightRequestId` is a no-op — assert this for
  success, failure, and conflict, including the case where the buffer was replaced in between.
- `editSaveSucceededAtom` clears the buffer (edit mode exits).
- `editSaveFailedAtom` leaves a character-identical draft and an error issue.
- `markEditConflictAtom` replaces an error issue and vice versa; the two never coexist.
- `overwriteNextSaveAtom` clears the conflict and sets the flag; `startEditSaveAtom` clears it.
- `replaceBufferFromRemoteAtom` replaces original, draft, and `baseMtime` and leaves the buffer
  open and clean.
- opening a second file while a buffer is open goes through `requestNavigationAtom`; the atom
  still holds exactly one buffer and the new selection does not apply until the guard resolves.

### `controller.test.ts` (the seams that actually break)

Thin fakes for the query client and the write call; no Lexical.

- a drawer close from the shell (mask/Escape path) routes through the guard.
- a changed `initialPath` while dirty routes through the guard and does not re-select underneath.
- a missing directory entry produces a conflict rather than recreating a deleted file.
- the pre-write fetch key carries the active `includeGitignored` value.
- a late success from file A does not mutate a buffer for file B.
- `agent-files/x.md` writes to the agent mount with path `x.md`, and its content-cache seed and
  directory fetch use that mount id.
- a successful save seeds the content cache with the exact draft and invalidates all four
  listing roots.
- the write goes out as multipart with the full path and `maxRetries: 0`.

### Deliberately not unit-tested

The Lexical editor itself and the antd rendering. Byte fidelity is instead structural: markdown
never enters rich mode, so there is no serializer in the path. A test asserts
`driveEditBufferMode` never produces a non-`codeOnly` editor configuration, and QA checks the
bytes.

## 11. The antd migration constraint

PR #5643 rewrites `import {X} from "antd"` to `import {X} from "@agenta/ui/ui"` across the app.
`@agenta/ui/ui` does not exist on `release/v0.109.0`, so nothing here can be forward-compatible.
The goal is to make the post-merge fixup mechanical.

| File | antd imports | Why here |
|---|---|---|
| `components/DriveEditBar.tsx` | `Segmented`, `Button`, `Tooltip` | The Source/Preview control is a segmented control in the spec's drawing, and `Segmented` is what `DriveToolbar` and `renderers.tsx` already use for that shape |
| `components/DriveEditBanner.tsx` | `Alert`, `Button` | `Alert` is already used in `Drives/` and carries both tones |

**Zero new antd import lines in existing files.** `DriveHeader.tsx` already imports `Button`,
`Tooltip`, and `Tag`. `DriveEditGuardModal` uses `EnhancedModal` from `@agenta/ui/components`,
which `web/AGENTS.md` requires over raw antd `Modal`. `DriveFileEditor` uses `SharedEditor`,
`EditorProvider`, and the existing `Markdown` component. `model.ts`, `state.ts`, `api.ts`, and
the controller have no React and no antd by construction.

After #5643 merges the fixup is two import lines.

**Lines not to touch:** the `CopyButton size="small"` occurrences in `DriveFilePreview.tsx`,
`DriveHeader.tsx`, and `FolderView.tsx`. #5643 changes each to `size="icon-sm"`.

## 12. Accessibility

- The header's `aria-live="polite"` region announces Saving, Saved, save errors, and conflicts.
- `DriveTreePane`'s `interactive={false}` sets `inert` so the tree's focusable row buttons and
  the focusable resize separator leave the tab order — pointer-events alone is not an interaction
  boundary.
- The guard modal returns focus to the editor on Keep editing.
- Both light and dark themes are checked for every new state, not only the happy-path editor:
  the error banner, the conflict banner, the disabled Edit tooltip, the saving spinner, the
  Unsaved and Saved tags, and the guard modal.

## 13. Build order

Each step leaves the tree building and testable.

1. `driveKinds.ts` gets `TEXT_CAP` and exports `CODE_LANGS`; `renderers.tsx` re-exports the cap.
   No behaviour change.
2. Package: `mountFileWrittenResponseSchema`, `writeMountFile`, and the three barrel exports.
   Verify the write against the local stack with a scratch call before any UI exists.
3. `editMode/model.ts` + `model.test.ts`. Pure, no UI.
4. `editMode/state.ts` + `state.test.ts`. Pure, no UI.
5. `editMode/api.ts` and `invalidateMountListings`.
6. `DriveFileEditor` and `DriveEditBar`, wired through `DriveFilePreview` and `DriveExplorer`.
   At the end of this step a `.txt` file edits and saves, with no guard and no conflict handling.
7. The controller: guard modal owned by `FilesDrawer`, the held `initialPath`, the guarded
   `select`, drop disabled while editing, `DriveTreePane` inertness, key bindings, header chips,
   tree-row dot.
8. `DriveEditBanner`, the pre-write check, Reload from disk, Overwrite.
9. Markdown Source/Preview, the session-teardown notice, the `aria-live` region.
10. `controller.test.ts`.
11. Both themes, then the five-extension QA matrix.
12. `pnpm lint-fix` inside `web/`.

Keep the reasoning in this document. Implementation comments are one short line each
(`web/AGENTS.md`); the only two that earn a line are the multipart-body constraint and the
stale-request check.
