# Implementation plan

Read `research.md` first. Three of its corrections change the API this plan calls.

Everything lives under `web/oss/src/components/Drives/`. Paths below are relative to that
directory unless they start with `web/`.

## 1. The state machine

### The twelve names and what they actually are

The spec lists twelve states. They are not twelve values of one variable. Three of them describe
the file before any editing starts, two describe how the buffer is rendered, and one is a
pending exit. Storing them as a flat enum produces an unreachable-combination mess (a file can
be dirty and in preview and in conflict at the same time).

So the stored state is a small record, and the twelve spec names are a **derived label**
computed from it. The derived label exists so the code and the spec share one vocabulary, and so
the state machine can be unit-tested against the spec name by name.

Stored record, one per open buffer:

```ts
// driveEditState.ts
export interface DriveEditBuffer {
    mountId: string
    /** Mount-relative path. The write target. */
    path: string
    /** Presented path with any `agent-files/` prefix. Breadcrumb, tree row, dialog copy. */
    displayPath: string
    /** Bytes as read when the buffer opened. Dirty is measured against this. */
    original: string
    draft: string
    /** mtime of the file when the buffer opened; null when the store omitted it. */
    baseMtime: number | null
    phase: "clean" | "dirty" | "saving" | "saved"
    view: "source" | "preview"
    banner: EditBanner | null
    pendingExit: ExitIntent | null
    /** Set by "Save anyway". Skips the pre-write mtime check for exactly one attempt. */
    forceNextSave: boolean
    /** When the save landed. Drives the two-second Saved chip. */
    savedAt: number | null
    /** Aborts an in-flight save when Cancel is pressed during `saving`. */
    abort: AbortController | null
}

export type EditBanner =
    | {kind: "error"; message: string}
    | {kind: "conflict"; theirMtime: number | null}

export type ExitIntent =
    | {kind: "cancel"}
    | {kind: "close"}
    | {kind: "select"; path: string}
    | {kind: "filter"; run: () => void}
    | {kind: "reload-theirs"}
```

The three pre-edit names come from a pure function over the selected file, not from the record:

```ts
// driveEdit.ts
export type DriveEditAffordance = "offer" | "capped" | "hidden"
```

Derived label:

| Spec name | Condition |
|---|---|
| `read` | no buffer, affordance `offer` |
| `locked` | no buffer, affordance `hidden` |
| `capped` | no buffer, affordance `capped` |
| `confirm` | `pendingExit != null` |
| `conflict` | `banner?.kind === "conflict"` |
| `error` | `banner?.kind === "error"` |
| `saving` | `phase === "saving"` |
| `saved` | `phase === "saved"` |
| `preview` | `view === "preview"` |
| `clean` | `phase === "clean"` |
| `dirty` | `phase === "dirty"` |
| `code` | buffer mode is `code` (orthogonal, reported alongside the label) |

`deriveEditStatus(buffer, affordance)` evaluates that table top to bottom and returns the first
match. The precedence is deliberate and matches the spec's own rendering rules: the guard dialog
sits over everything; the banner slot holds exactly one banner ("uses the same banner slot as
the conflict case, so only one can ever be shown"); phase beats view.

`code` is not returned by `deriveEditStatus`. It is a second value, `driveEditBufferMode(path)`
returning `"markdown" | "code"`, because the spec's own note says everything else about the
`code` state is identical: "One state machine for all text kinds."

### Where the state lives

```ts
// driveEditState.ts
export const driveEditBufferAtomFamily = atomFamily(
    (_driveKey: string) => atom<DriveEditBuffer | null>(null),
)
```

**Keyed by the drive's mount id** (`drive.mount?.id ?? ""`), the same key
`driveSelectionAtomFamily` already uses in `useDriveSelection.ts`. Reasons:

- The value is a single nullable buffer, never a map. One drive therefore cannot hold two
  buffers. That is the "one file at a time" rule enforced by the type, not by a check.
- Module-level, so it survives the drawer's `destroyOnClose` remount the same way the persisted
  selection does. A user who accidentally closes the drawer does not silently lose a buffer,
  though the guard should have caught them first.
- Scoped per drive, so the chat host and the config host cannot fight over one slot if both
  ever mount at once.

Derived read atoms in the same file:

```ts
export const driveEditDirtyAtomFamily      // buffer != null && draft !== original
export const driveEditStatusAtomFamily     // deriveEditStatus(...) for display and tests
export const driveEditPathAtomFamily       // the display path, or null. Read by DriveTreeRow
                                           // for the dirty dot, so the dot needs no prop drilling.
```

Write-only action atoms, one per transition. Every one of them is pure state manipulation with
no I/O, so the whole machine tests with a bare `createStore()` and no React:

| Atom | From | To |
|---|---|---|
| `openEditBufferAtom({mountId, path, displayPath, original, baseMtime})` | no buffer | `clean` |
| `setEditDraftAtom(text)` | `clean` or `dirty` | `dirty`, or back to `clean` when text equals `original` |
| `setEditViewAtom("source" \| "preview")` | any | same phase, new `view` |
| `requestEditExitAtom(intent)` | `clean` | runs the intent, clears the buffer |
| | `dirty` / banner set | sets `pendingExit`, renders the guard |
| `resolveEditExitAtom("keep")` | `pendingExit` set | clears `pendingExit`, phase unchanged |
| `resolveEditExitAtom("discard")` | `pendingExit` set | runs the intent, clears the buffer |
| `resolveEditExitAtom("save")` | `pendingExit` set | starts a save; the intent runs on success |
| `startEditSaveAtom(abort)` | `clean` / `dirty` | `saving`, clears any banner |
| `editSaveSucceededAtom({size, mtime})` | `saving` | `saved` if draft unchanged during the write, otherwise `dirty` |
| `editSaveFailedAtom(message)` | `saving` | `dirty`, `banner = {kind:"error"}`, draft untouched |
| `markEditConflictAtom(theirMtime)` | any open buffer | `banner = {kind:"conflict"}` |
| `forceNextEditSaveAtom()` | `conflict` banner | clears the banner, sets `forceNextSave` |
| `adoptTheirsAtom({content, mtime})` | any open buffer | replaces `original`, `draft`, `baseMtime`; phase `clean`; clears the banner |
| `closeEditBufferAtom()` | any | no buffer |

Setting either banner clears the other. That is one line in the reducer and it is what makes the
"only one banner can ever be shown" rule impossible to violate.

`editSaveSucceededAtom` returning to `dirty` instead of `saved` when the draft moved during the
write is the spec's rule: "If the user has already typed again during the write, stay in edit
mode and go straight back to dirty."

### Exit routes that must run through the guard

The spec names five, and they all call `requestEditExitAtom`:

| Route | Where it is intercepted |
|---|---|
| Cancel button | `DriveHeader` edit cluster |
| Escape | drawer-level `keydown` in `useDriveEdit` |
| Closing the drawer | `DriveExplorer` wraps the `onClose` it passes to `DriveHeader` |
| Selecting another file or folder | `DriveExplorer` wraps `select` before handing it to the tree, the breadcrumb, the folder grid, and `DriveFilePreview` |
| Changing a filter | not reachable: the edit bar replaces the toolbar, so search, origin, and the visibility toggles are unmounted while editing. The intent kind stays in the union for the browser-unload case and for any future control that survives the swap. |
| Browser unload | `beforeunload` listener in `useDriveEdit`, registered only while dirty. The browser shows its own dialog; ours cannot run there. |

## 2. Files that change and how

### Existing files

**`driveKinds.ts`**: move `TEXT_CAP` here from `renderers.tsx` and export it. This module is
deliberately React-free and renderer-free so light consumers can import it; the edit gate is
exactly such a consumer and must not pull the Shiki and Markdown graph in to read a number. Add
nothing else.

**`renderers.tsx`**: one line: `export {TEXT_CAP} from "./driveKinds"` and import it from there
for the existing cap checks. One definition, both readers. No other change to this file.

**`DriveHeader.tsx`**: add one optional prop group:

```ts
edit?: {
    affordance: DriveEditAffordance
    editing: boolean
    dirty: boolean
    saved: boolean
    saving: boolean
    onEdit: () => void
    onCancel: () => void
    onSave: () => void
}
```

Three changes inside:

1. In the browsing cluster, between the details toggle and `DriveFileDownloadButton`, render an
   Edit button when `affordance === "offer"`, or a disabled Edit button with a tooltip naming the
   cap when `affordance === "capped"`. Render nothing when `hidden`. Secondary style, never
   primary: Download stays the loudest action for a reader.
2. When `edit.editing`, replace the whole right-hand cluster (upload, copy, details, download,
   overflow) with Cancel and Save. Save is `type="primary"` and disabled unless dirty; during
   `saving` it shows the antd `loading` spinner and reads "Saving". Cancel stays enabled during
   `saving` so a slow mount does not trap anyone.
3. Next to the origin `Tag`, render an "Unsaved" `Tag` when dirty, or a success-toned "Saved"
   `Tag` when `saved`. Both reuse the already-imported `Tag`.

Do not touch the `CopyButton size="small"` line. The antd migration branch changes it.

**`DriveToolbar.tsx`**: unchanged. `DriveExplorer` chooses between it and `DriveEditBar`. Adding
an `editing` flag to `DriveToolbar` would mean threading every filter prop through a component
that renders none of them while editing, and would grow that file's antd surface for no gain.

**`DriveFilePreview.tsx`**: when a buffer is open for this file, render `DriveFileEditor`
instead of `DriveFileContentViewer`. The meta band above it is unchanged and still obeys
`detailsOpen`. Do not touch its `CopyButton size="small"` line.

**`DriveFileContentViewer.tsx`**: unchanged.

**`DriveTreeRow.tsx`**: read `driveEditPathAtomFamily` and render a small dot on the row whose
path matches. The spec asks for exactly two dirty affordances, one dot each: this one and the
header chip.

**`DriveExplorer.tsx`**: the composition work:

- call `useDriveEdit({drive, selectedPath, select, onClose, canUpload})`
- swap `<DriveToolbar/>` for `<DriveEditBar/>` while editing
- pass the `edit` prop group to `DriveHeader`
- pass the guarded `select` to the tree, the breadcrumb, the folder grid, and the preview
- render `<DriveEditBanner/>` between the second header row and the body, in the one banner slot
- render `<DriveEditGuardModal/>` and `<DriveEditDiffModal/>` at the end of the chrome branch
- while editing, give the tree pane `pointer-events-none opacity-45` and `inert`, so its scroll
  position and expanded folders survive

### New files

| File | Contents | React? | antd? |
|---|---|---|---|
| `driveEdit.ts` | Pure helpers: `EDIT_KINDS`, `driveEditAffordance`, `driveEditBufferMode`, `driveEditorLanguage`, `isEditDirty`, `deriveEditStatus`, `conflictFromActivity` | no | no |
| `driveEditState.ts` | The atom family and every action atom above | no | no |
| `driveEditSave.ts` | The Fern call, the pre-write mtime re-check, cache invalidation | no | no |
| `useDriveEdit.ts` | Wires atoms to the drawer: reads the original bytes, runs the save, subscribes to file activity, binds the keys | hook | no |
| `DriveEditBar.tsx` | Header row 2 while editing: "Editing" label, Source/Preview segmented for markdown, language chip for code, the hint line | yes | `Segmented`, `Button`, `Tooltip` |
| `DriveFileEditor.tsx` | The editor pane: `SharedEditor` in an `EditorProvider`, the markdown synchroniser, the preview pane, the status footer | yes | no |
| `DriveEditBanner.tsx` | The one banner slot: error with Try again, conflict with View diff / Reload theirs / Save anyway | yes | `Alert`, `Button` |
| `DriveEditGuardModal.tsx` | Discard dialog. `EnhancedModal` from `@agenta/ui/components` | yes | no |
| `DriveEditDiffModal.tsx` | View diff. `computeTextDiffLines` list, or `DiffView` for the `json` kind | yes | no |
| `driveEdit.test.ts` | Unit tests for the pure helpers | no | no |
| `driveEditState.test.ts` | Unit tests for the transitions | no | no |

## 3. Reusing the editor components

### Which wrapper, and why not the other one

Use `SharedEditor` from `@agenta/ui/shared-editor`, wrapped in our own `EditorProvider` from
`@agenta/ui/editor`.

Do **not** use `SimpleSharedEditor`. It sniffs the content on every render and forces the editor
into JSON, YAML, or HTML mode when the text happens to parse as one
(`SimpleSharedEditor/index.tsx:288-311`). A `.txt` file containing a single JSON object would
silently become a JSON code editor with a format dropdown. It also renders its own header with
Format, Copy, and Minimize controls, which duplicates what the edit bar owns. Its value is the
prompt-field use case, not a file buffer.

The right precedent to copy is `ChatMessageEditor.tsx` in `@agenta/ui`: same `EditorProvider` +
`SharedEditor` + `noProvider` shape, and it already solves the markdown-view dispatch race.

### The editor call

```tsx
// DriveFileEditor.tsx
const mode = driveEditBufferMode(path)          // "markdown" | "code"
const language = driveEditorLanguage(path)      // CodeLanguage, only used when mode === "code"
const editorId = `drive-edit-${mountId}-${path}`

<EditorProvider
    codeOnly={mode === "code"}
    language={mode === "code" ? language : undefined}
    enableTokens={false}
    showToolbar={false}
    disabled={phase === "saving"}
    id={editorId}
>
    <SharedEditor
        id={editorId}
        editorType="borderless"
        state={phase === "saving" ? "readOnly" : "filled"}
        initialValue={original}
        value={draft}
        handleChange={onDraftChange}
        disableDebounce
        noProvider
        autoFocus
        editorProps={{
            codeOnly: mode === "code",
            language: mode === "code" ? language : undefined,
            noProvider: true,
            showToolbar: false,
            enableTokens: false,
        }}
        footer={<DriveEditStatusBar mode={mode} language={language} savedAt={savedAt} />}
        className={view === "preview" ? "hidden" : undefined}
    />
    {mode === "markdown" ? <MarkdownSourceSynchronizer editorId={editorId} /> : null}
</EditorProvider>
```

Prop-by-prop, with the reason each value is what it is:

- `editorType="borderless"`: the pane already draws the inset border. A second border reads as a
  nested box.
- `state`: `"readOnly"` while saving. The spec chose this over an overlay: "typing into a buffer
  that's mid-flight is the bug this prevents." The other five values in the union are not used;
  `filled` covers every other phase and focus is handled by the component's own tracking.
- `disableDebounce`: required. The default is a 300 ms `useDebounceInput` window
  (`SharedEditor.tsx:76-81`). Dirty tracking has to be keystroke-accurate, or Save stays disabled
  for a third of a second after the first keystroke and the guard can miss a change typed
  immediately before Escape.
- `initialValue` + `value`: `SharedEditor` uses `initialValue` for the mount-time Lexical seed
  and `value` for the controlled sync (`SharedEditor.tsx:71-73`). Pass `original` and `draft`.
  Do not pass `syncWithInitialValueChanges`: it would re-seed the buffer when the underlying
  query refetches, which is exactly the overwrite we are trying to prevent.
- `noProvider` on both the wrapper and `editorProps`: we own the provider, as `ChatMessageEditor`
  does.
- `autoFocus`: the spec wants focus in the editor on open, cursor at the start of the document.
- `footer`: the status bar (language, `UTF-8`, cursor position, last-saved). Uses the slot rather
  than a sibling so it sits inside the editor's border.

### Source and preview for markdown

Two separate mechanisms, and it is easy to conflate them.

**The buffer is always raw markdown source.** `MarkdownSourceSynchronizer` pins
`SET_MARKDOWN_VIEW` to `true` for the life of a markdown buffer, and sets `markdownViewAtom(editorId)`
to `true` so the CSS flag agrees with the node state. It is a direct copy of
`MarkdownViewSynchronizer` from `ChatMessageEditor.tsx:88-104`, including both dispatches:
a `useLayoutEffect` for the steady state, and a `requestAnimationFrame` in a `useEffect` for the
mount race where the layout effect fires before `MarkdownPlugin` registers the command. Setting
the atom alone does nothing; the comment in `ChatMessageEditorProps.markdownView` says so and the
plugin confirms it. Editing markdown as rich text would round-trip the file through the markdown
serialiser on every keystroke and reflow formatting the user never touched.

**Preview is a separate pane.** The Source/Preview segmented in the edit bar sets
`buffer.view`. In `preview`, the `SharedEditor` gets `className="hidden"` (it stays mounted, so
cursor position and undo history survive the round trip) and we render the existing `Markdown`
component from `@/oss/components/AgentChatSlice/assets/markdown` over `draft`, inside the same
scroll container `TextBody` uses (`renderers.tsx:153-160`). That satisfies the spec's requirement
that nothing shifts between preview and the read-only view after save, because it is literally
the same component.

Preview is offered only when `mode === "markdown"`. For `code` the edit bar shows the language
chip instead, so the bar does not reflow.

### codeOnly and the language mapper

`driveEditorLanguage(path)` maps the Shiki id from `driveCodeLanguage(path)` into the six-value
`CodeLanguage` union (see `research.md` correction 4):

```
json, yaml            -> "json" / "yaml"
python                -> "python"
javascript, jsx, mjs  -> "javascript"
typescript, tsx       -> "typescript"
everything else       -> "code"
```

`"code"` is the union's generic highlighter and is the honest answer for shell, Rust, Go, CSV,
plain text, and `.env`. A unit test asserts every value in `CODE_LANGS` maps into the union, so
adding a language to `driveKinds.ts` later cannot produce a type error at a call site far away.

### DiffView and the conflict diff

`DriveEditDiffModal.tsx` shows the mount's current bytes against the buffer.

- kind `json`: `<DiffView language="json" original={theirs} modified={draft} />`. This is the one
  case `DiffView` handles correctly.
- every other kind: `computeTextDiffLines(theirs, draft, {contextLines: 3, enableFolding: true,
  foldThreshold: 5})` from `@agenta/ui/diff`, rendered as a list of lines coloured by
  `line.type`. `DiffView` cannot be used here; `research.md` correction 2 has the evidence.

## 4. The save path

```ts
// driveEditSave.ts
import {getMountsClient, projectScopedRequest} from "@agenta/entities/session"

export async function writeDriveFile({
    mountId, path, content, projectId, signal,
}): Promise<{ok: true; size: number} | {ok: false; message: string}> {
    const name = path.split("/").pop() || "file"
    const file = new File([content], name, {type: "text/plain"})
    try {
        const written = await getMountsClient().uploadMountFile(
            {mount_id: mountId, path, file},
            projectScopedRequest(projectId, undefined, signal, 0),
        )
        const parsed = safeParseWithLogging(
            mountFileWrittenResponseSchema, written, "[writeDriveFile]",
        )
        return {ok: true, size: parsed?.size ?? content.length}
    } catch (error) {
        if (isAbortError(error)) throw error
        return {ok: false, message: toWriteErrorMessage(error)}
    }
}
```

Notes on each choice:

- `uploadMountFile`, not `writeMountFile`. The generated `writeMountFile` sends no body and would
  truncate the file. Both endpoints call the same `MountsService.write_file`. `research.md`
  correction 1 has the proof.
- `path` is the full mount-relative path. `upload_mount_file` uses the query `path` verbatim
  unless it is empty or ends in `/` (`api/oss/src/apis/fastapi/mounts/utils.py:79-83`), so a
  full path overwrites exactly that object.
- `projectScopedRequest(..., signal, 0)`. `maxRetries: 0` because a write must never be retried
  transparently: a retried PUT after a timeout can land after the user has already edited again.
- Not `callFern`. It converts every failure into `null` and the error state needs the message.
  Aborts are rethrown so Cancel during `saving` unwinds cleanly.
- A zod parse at the boundary, per `web/AGENTS.md`. Add `mountFileWrittenResponseSchema` to
  `packages/agenta-entities/src/session/core/schema.ts` next to the existing mount schemas
  (`{path: z.string(), size: z.number().nullish()}`), since none exists yet.

### What is invalidated after a successful write

In order, and deliberately narrow:

1. `queryClient.setQueryData(mountFileContentQueryKey(projectId, mountId, path), draft)`:
   seed the cache with the bytes we just wrote. This is what lets the drawer return to the
   read-only view with the saved text already rendered, with no refetch and no skeleton flash.
2. `queryClient.invalidateQueries({queryKey: mountDirQueryKey(projectId, mountId, parentDir)})`:
   the file's own directory level. This refreshes `size` and `mtime` for the tree row and the
   header chip, and it is how we learn the post-write mtime the response does not carry.
3. `queryClient.invalidateQueries({queryKey: ["mounts", "files", projectId, mountId]})`: the
   whole-mount listing, used by the recents and the search view.

Do **not** call `revalidateSessionMountsAtom`. It invalidates every mount in the project plus
every cached body (`mounts.ts:219-247`), which is right for a finished agent turn and far too
wide for a one-file save.

## 5. Conflict detection

Two independent triggers. Neither is sufficient alone.

### Trigger one: the file-activity signal

`useDriveEdit` subscribes to `latestSessionFileActivityAtomFamily(sessionId)` with
`sessionId = useDriveSessionId()`. A pure predicate decides:

```ts
// driveEdit.ts
export function conflictFromActivity(
    entry: SessionFileActivityEntry | null,
    buffer: DriveEditBuffer | null,
    selfWriteUntil: number,
): boolean {
    if (!entry || !buffer) return false
    if (entry.resolved?.mountId !== buffer.mountId) return false
    if (entry.resolved?.path !== buffer.path) return false
    if (entry.at <= buffer.openedAt) return false
    if (entry.at <= selfWriteUntil) return false
    return true
}
```

Limitation, stated plainly: the config-panel host does not mount `DriveSessionProvider`, so
`useDriveSessionId()` returns null there and this trigger never fires. Trigger two covers that
host. This is not worth fixing by threading a session id through the config host, because the
pre-write check is the one that actually prevents data loss; the activity signal only makes the
warning arrive earlier.

### Trigger two: the pre-write modification-time check

The spec requires the conflict be "re-checked immediately before every write". Before calling
`writeDriveFile`, and unless `forceNextSave` is set:

1. `await queryClient.fetchQuery({queryKey: mountDirQueryKey(projectId, mountId, parentDir), ...})`
   with `staleTime: 0`, so it goes to the network.
2. Find the entry whose `path` matches and read its `mtime`.
3. If both `mtime` and `buffer.baseMtime` are non-null and differ, do not write. Call
   `markEditConflictAtom(theirMtime)` and stop. Otherwise proceed.

A null on either side means the object store did not report a time, and the check cannot fire.
That is a silent degradation, so it is recorded in `status.md` rather than hidden.

`baseMtime` at open comes from the directory listing already cached for the file's folder
(`mountDirQueryFamily`), falling back to the drive's `recents` entry, falling back to null.

### The write response has no modification time

`MountFileWrittenResponse` returns `path` and `size` only. Handled in two parts, neither of which
touches the backend:

**Self-write suppression.** On a successful save, set a module-level
`selfWriteUntil = Date.now() + SELF_WRITE_GRACE_MS` (5000) for that `(mountId, path)`.
`conflictFromActivity` ignores any activity entry inside that window, and the pre-write check is
skipped for the same window. Without this, the invalidation we fire ourselves in step 2 above
would return a new mtime and raise a conflict against our own bytes.

**Adopt the real mtime one refetch later.** The directory invalidation lands within the grace
window. When it does, and the buffer is still open (the user kept editing after saving), read the
fresh entry's mtime and write it into `buffer.baseMtime`. The window closes and conflict
detection is armed again against a true value.

The effect is that "no mtime on the write response" costs one extra listing refetch we were
already firing, and a five-second window in which a conflict raised by someone else would be
missed. That window is acceptable: the pre-write check on the *next* save still catches it, and
the alternative is a backend change that turns a frontend PR into a cross-stack one.

### The three ways out of a conflict

- **View diff** opens `DriveEditDiffModal` with the freshly-fetched mount bytes as original and
  the draft as modified.
- **Reload theirs** routes through the guard when dirty (it discards the buffer), then invalidates
  and refetches `mountFileContentQueryKey`, then calls `adoptTheirsAtom({content, mtime})`.
- **Save anyway** calls `forceNextEditSaveAtom()` and then saves. The flag clears after one
  attempt, so a second conflict is caught normally. The button copy says it overwrites.

## 6. Which files can be edited

### The rule

```ts
// driveEdit.ts
export const EDIT_KINDS = new Set<DriveFileKind>([
    "markdown", "text", "code", "json", "csv", "html",
])

export function driveEditAffordance({kind, size, canWrite}): DriveEditAffordance {
    if (!canWrite) return "hidden"
    if (!EDIT_KINDS.has(kind)) return "hidden"
    if (size != null && size > TEXT_CAP) return "capped"
    return "offer"
}
```

`kind` comes from `resolveDriveFileKind(path)`. There is no second extension list anywhere in
this feature. `TEXT_CAP` is the existing 1.5 MB constant, moved to `driveKinds.ts` and imported
here. `canWrite` is the drawer's existing `canUpload`
(`isAgentFileUploadsEnabled() && !explicitFiles && !!drive.mount`), which is the closest thing to
a writable-mount answer the frontend has. `mountSchema` has no read-only flag to read and we do
not invent one.

`hidden` renders no Edit button at all. `capped` renders it disabled with a tooltip naming the
cap. The spec's reasoning: a category is not a limit, and a disabled Edit on every image would
train people to ignore the button.

### The five extensions the user will QA

| Extension | `resolveDriveFileKind` | Affordance | Buffer mode | Read view today | What editing does |
|---|---|---|---|---|---|
| `.txt` | `text` | offer | `code`, language `code` | `TextBody`, a `<pre>` | plain source buffer, verbatim round trip |
| `.csv` | `csv` | offer | `code`, language `code` | `CsvBody`, a parsed table | swaps to a plain source buffer over the raw text; the table returns after save |
| `.md` | `markdown` | offer | `markdown` | `TextBody` rendering `Markdown` | raw markdown source, with a Preview pane using the same `Markdown` component |
| `.env` | `text` | offer | `code`, language `code` | `TextBody`, a `<pre>` | same as `.txt` |
| `.json` | `json` | offer | `code`, language `json` | `CodeBody`, pretty-printed | source buffer seeded from the **raw** content, not from the pretty print |

Three of these carry a trap worth stating:

**`.json` must not be seeded from the read view.** `CodeBody` runs
`JSON.stringify(JSON.parse(content), null, 2)` before displaying
(`renderers.tsx:178-186`). Seeding the buffer from that reformats the entire file the moment the
user changes one line. Seed from `useDriveFileText` directly, which returns the raw content
string.

**`.csv` becomes text while editing.** The spec lists `csv` among the editable kinds and there is
no cell editor here. The table is a read view only.

**`.env` works, `.env.local` does not.** `resolveDriveFileKind(".env")` returns `text` because
the pattern `/\.(txt|log|env)$/i` matches a leading dot. `.env.local` matches nothing and lands on
`other`, which shows the download card and offers no Edit. Widening the resolver would change the
read-only viewer's behaviour for every host, so it stays out of this PR and is logged in
`status.md`. Also note `.env` is a dotfile: it appears only with the hidden-files toggle on, which
is its default (`useDriveFilters.ts:16`).

For completeness on the non-QA kinds: `.html` is editable as a `code` buffer (its read view has
its own Preview/Source toggle, which is unrelated and untouched); `image`, `pdf`, `audio`,
`video`, and `other` are `hidden`.

## 7. Test plan

Vitest, colocated, following `dropEntries.test.ts`. No snapshot tests of the rendered drawer.

### `driveEdit.test.ts` (pure helpers)

- `resolveDriveFileKind` for `.txt`, `.csv`, `.md`, `.env`, `.json`, plus `agent-files/.env`,
  `.env.local`, `.png`, `.pdf`, `README`. This locks the dotfile behaviour that the whole `.env`
  story rests on.
- `driveEditAffordance` across the matrix: every kind, times `{size under cap, size exactly cap,
  size over cap, size null}`, times `{canWrite true, canWrite false}`. Assert `capped` only ever
  appears for a kind in `EDIT_KINDS`, and that `size == null` never produces `capped`.
- `driveEditBufferMode`: `markdown` only for markdown extensions, `code` for everything else.
- `driveEditorLanguage`: every key of `CODE_LANGS` maps into the six-value `CodeLanguage` union,
  and `.json` maps to `json`, `.yaml` to `yaml`, `.py` to `python`, `.sh` to `code`.
- `isEditDirty`: differs, identical, identical after retyping, trailing-newline difference,
  empty original.
- `deriveEditStatus`: one assertion per spec name, twelve in total, each with the minimal record
  that produces it. Plus the precedence cases: dirty and in preview returns `preview`; dirty with
  a conflict banner returns `conflict`; conflict with a pending exit returns `confirm`.
- `conflictFromActivity`: matching path and mount, wrong mount, wrong path, entry timestamped
  before the buffer opened, entry inside the self-write grace window, null entry, null buffer.

### `driveEditState.test.ts` (transitions)

Uses a bare jotai `createStore()`. No React, no rendering.

- open puts the machine in `clean` with Save disabled.
- one edit gives `dirty`; editing back to the original text returns to `clean`.
- `clean` plus `requestEditExitAtom` runs the intent immediately, with no guard.
- `dirty` plus `requestEditExitAtom` sets `pendingExit` and does not run the intent.
- `resolveEditExitAtom("keep")` clears `pendingExit` and leaves the phase and the draft alone.
- `resolveEditExitAtom("discard")` runs the intent and clears the buffer.
- `resolveEditExitAtom("save")` starts a save and runs the intent only after success. A failed
  save leaves the intent unrun and the buffer alive.
- `saving` then `editSaveSucceededAtom` gives `saved`. `saving`, then an edit, then
  `editSaveSucceededAtom` gives `dirty`, not `saved`.
- `editSaveFailedAtom` gives `dirty` with an error banner and a character-identical draft.
- `markEditConflictAtom` while an error banner is showing replaces it, and the reverse. Assert
  the two banners never coexist.
- `forceNextEditSaveAtom` clears the conflict banner and sets `forceNextSave`; the flag is
  cleared by the next `startEditSaveAtom`.
- `adoptTheirsAtom` replaces original, draft, and `baseMtime`, and returns the phase to `clean`.
- opening a second file while a buffer is open: `requestEditExitAtom({kind:"select"})` is what
  runs, the atom value is still exactly one object, and the new selection does not apply until
  the guard resolves.

### What is deliberately not unit-tested

The Lexical editor itself, the `SET_MARKDOWN_VIEW` dispatch timing, and the antd rendering. Those
are covered by the live QA matrix in `CONTEXT.md`, which is where the markdown source toggle and
the two themes actually get checked.

## 8. The antd migration constraint

PR #5643 rewrites `import {X} from "antd"` to `import {X} from "@agenta/ui/ui"` across the app.
`@agenta/ui/ui` does not exist on `release/v0.109.0`, so nothing here can be written
forward-compatible. The goal is instead to make the post-merge fixup mechanical and short.

**antd imports this feature adds, in full:**

| File | antd imports | Why here |
|---|---|---|
| `DriveEditBar.tsx` | `Segmented`, `Button`, `Tooltip` | The Source/Preview control is a segmented control by the spec's own drawing, and `Segmented` is what `DriveToolbar` and `renderers.tsx` already use for the same shape. |
| `DriveEditBanner.tsx` | `Alert`, `Button` | `Alert` is already used elsewhere in `Drives/` and carries the error and warning tones the two banners need. |

**Zero new antd import lines in existing files.** `DriveHeader.tsx` already imports `Button`,
`Tooltip`, and `Tag`, which is everything its Edit / Cancel / Save / chip additions need.

**Files that avoid antd entirely and why:**

- `DriveEditGuardModal.tsx` and `DriveEditDiffModal.tsx` use `EnhancedModal` from
  `@agenta/ui/components`. `web/AGENTS.md` requires it over raw antd `Modal`, and it keeps the two
  dialogs out of the migration's path.
- `DriveFileEditor.tsx` uses `SharedEditor`, `EditorProvider`, and the existing `Markdown`
  component. No antd.
- `driveEdit.ts`, `driveEditState.ts`, `driveEditSave.ts`, `useDriveEdit.ts` have no React and no
  antd by construction.

So the whole feature concentrates raw antd into two new files. After #5643 merges, the fixup is
two import lines.

**Lines not to touch:** the `CopyButton size="small"` occurrences in `DriveFilePreview.tsx`,
`DriveHeader.tsx`, and `FolderView.tsx`. #5643 changes each of them to `size="icon-sm"`. Leaving
them alone keeps the merge clean.

## 9. Build order

Each step leaves the tree building and testable.

1. `driveKinds.ts` gets `TEXT_CAP`; `renderers.tsx` re-exports it. No behaviour change.
2. `driveEdit.ts` plus `driveEdit.test.ts`. Pure, no UI.
3. `driveEditState.ts` plus `driveEditState.test.ts`. Pure, no UI.
4. `driveEditSave.ts` and the `mountFileWrittenResponseSchema` addition. Verify the write against
   the local stack with a scratch call before any UI exists.
5. `DriveFileEditor.tsx` and `DriveEditBar.tsx`, wired into `DriveFilePreview` and
   `DriveExplorer`. At the end of this step a `.txt` file edits and saves, with no guard, no
   banner, and no conflict handling.
6. `useDriveEdit.ts`: the guard, `DriveEditGuardModal`, the key bindings, the tree pane going
   inert, the header chips, the tree-row dot.
7. `DriveEditBanner.tsx`, the pre-write check, self-write suppression, the activity subscription,
   `DriveEditDiffModal.tsx`.
8. Markdown Source/Preview.
9. Both themes, then the five-extension QA matrix.
10. `pnpm lint-fix` inside `web/`.
