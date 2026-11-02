# Files pane redesign on `/m` — implementation plan

## Context

The agent playground's docked Files pane (chat host, `/m`) gets the redesign in the Claude Design
project `81fb7bab…` / artifact `CoKS7o7cyKvcY3sssq4qP9`. The pane keeps its geometry (docked right
of the chat, tree rail on the right, resizable) and replaces its chrome and folder content, and adds
writes (create / rename / delete / edit markdown). Today it is read-only + upload / download.

Code lands in `web/packages` (`@agenta/entities/drive`, `@agenta/entity-ui/drive`, one prop on
`@agenta/ui/list-table`) and `web/mobile`. We verify on `/m` only. The desktop and the `/m` overlay
drawers (config-pane Files, agent overview drive card) reuse `DriveExplorer` and inherit the chrome.

Decisions taken: (1) rich-text editing on the existing Lexical `MarkdownEditor` (package code; the
mobile lint rule only bans direct Lexical imports in `web/mobile/src`, and `/m` already renders it
for instructions); (2) folder rename / move out of scope (no backend move endpoint); (3) desktop
untested. A fresh-eyes review of the first draft found 22 issues; this version folds them in.

## What exists and gets reused (no duplication)

| Need | Reuse |
|---|---|
| Composition root, filters, selection, tree pane, uploads, drop, lazy tree, virtualised grid | `DriveExplorer.tsx`, `useDriveFilters`, `useDriveSelection`, `useDriveTreePane`, `useDriveUploads`, `useDriveTreeData`, `VirtualTileGrid` — kept, extended in place |
| List view | `ListTable` (`@agenta/ui/list-table`, the sessions / automations table) + one new `wrapRow` prop |
| Markdown editing, formatting bar, source ↔ rendered | `MarkdownEditor` (`entity-ui/DrillInView/SchemaControls`) + `MarkdownToolbar` (`@agenta/ui`) + new `toolbarContainer` / `layout="inline"` props |
| Transport | Fern `getMountsClient().createMountFolder` / `.deleteMountFile` (`@agenta/sdk/resources:143`); text save + rename / duplicate / move through the existing `uploadMountFile` (`driveMedia.ts:165`, multipart → `write_file`, overwrites) and `fetchMountFileBlob`; `useMountUpload`'s `refreshListing` extracted and shared |
| File text | `mountFileContentQueryFamily` (`@agenta/entities/session`) |
| Confirm dialog | `modal.confirm` from `@agenta/ui/app-message` (Radix `AlertDialog`; already the delete confirm in `useSessionActions`, `useAgentActions`, `/m` `LiveConversation`) |
| Toasts | `message` from `@agenta/ui/app-message` |
| Menus, segmented, dialog, tooltips, inputs | `DropdownMenu*`, `Segmented`, `Dialog`, `SimpleTooltip`, `InputAffix` from `@agenta/ui/ui` |
| Labels / formatters / sort | `fileTypeLabel`, `resolveDriveFileKind`, `humanSize`, `relativeTime`, `driveRootLabel`, `buildDriveTree`'s `sortLevel` (extracted) |
| Kind → tone | `driveIcons.tsx`'s kind → `colorInfo / Warning / Error / neutral` map, extracted to entities `driveKinds.ts` and read by both the icon and the new type mark |
| Item context menu, copy path, download | `DriveItemContextMenu`, `useCopyDrivePath`, `useDriveItemDownload`, `useDriveDownloadAll` |
| Shortcut ids | `packages/agenta-shared/src/utils/shortcuts.ts` (`panel.files` exists; add `drive.save`) |
| Rendered markdown on `/m` | `ChatMarkdown` (`@agenta/chat/markdown`) via `registerDriveMarkdown` |
| "No files match." rail line | `DriveTreeList.tsx:80` — relabel to "No matches" |

Colours: the design's chips are the theme's `info` (#113955 text, folder / md), `warning` +
`warningBg` (json / image), `success` + `successBg` (py / csv), `error` + `errorBg` (html / pdf),
neutral `colorFillTertiary` (md / txt chip bg). All bridged on mobile (`globals.css`
`--color-color*`). `colorInfoBg` is not bridged and not needed (the md chip bg is neutral).

## Changes

### Step A — Chrome: two rows, rail search, stateful toggles

`@agenta/entities/src/drive`
- `useDriveSelection.ts` (edit): grow it with history — `back`, `forward`, `canBack`,
  `canForward` over the existing `select` (so the quick-look `initialPath` effect at :83 pushes
  too). Pure stack logic in `driveHistory.ts` (push drops forward entries; same path = no-op),
  unit-tested as a pure function (entities' vitest is node-only, no hook rendering).
- `useDriveFilters.ts` (edit): persisted prefs via `atomWithStorage` (`agenta:drive:view`,
  `:sort`, `:show-hidden`, `:show-gitignored`, `:show-temporary`, `:editor-mode`). `showHidden` /
  `showGitignored` stay **session-local state seeded from the pref**: the view-options menu writes
  pref + state, `useUploadReveal` (which flips them to reveal a dotfile upload) writes state only,
  so a reveal never rewrites the user's preference. `showTemporary` (default false) maps to
  `originFilter` **only when the drive has mixed origins** (`showOrigin`); otherwise
  `originFilter` stays `"all"`, so a plain session drive never filters itself empty.
- `driveTree.ts` (edit): `DriveTreeNode.modifiedAt` from `MountFile.mtime` in `buildDriveTree`
  (files only — folder entries carry no mtime); export the folders-first `sortLevel` comparator.
- `driveKinds.ts` (edit): `driveKindTone(kind)` → `{text, bg}` token classes + chip label, the one
  table `driveIcons.tsx` and the new type mark both read.

`@agenta/entity-ui/src/drive`
- `DriveExplorer.tsx` (edit): chrome mode becomes an explicit `chrome?: boolean` (today it is
  inferred from `onClose != null`, :123); `onClose` stays optional and only draws the "×" / "»".
  Wire history, the row-2 variant, the two header slots; remove the details / repo-probe state
  from the chrome path; the `searchActive`-forces-tree rule stays; terminal states (error /
  empty) render row 1 only.
- `SessionFilesPane.tsx` (edit): new `closeControl?: "collapse" | "none"` (default `"collapse"`,
  the desktop's `oss/.../SessionFilesPane.tsx` wrapper unchanged); `/m` passes `"none"`.
- `DriveHeader.tsx` → **row 1** (48px, spans content + rail): `‹ ›` · `DriveBreadcrumb`
  (`variant="icons"`) · path `⋯` (Copy path · Download all (.zip) / Download (size) · Upload
  files… · the inspector's Copy Drive / Session ID items, gated as today) · view-options menu
  (checkable: Show temporary files — only when `showOrigin`; Show hidden files; Show git-ignored
  files — only when `inGitScope`) · tree toggle (folder icon, highlighted while the rail shows) ·
  optional close ("×" overlay / "»" docked) · optional expand toggle (overlay). Removed per design:
  count chip, origin tag, details / repo toggle, inline upload / copy / download buttons. The
  `partialErrored` warning + retry stays. Repo facts and file meta are no longer reachable from
  the chrome (the embedded, non-chrome `FolderView` / `DriveFilePreview` headers keep them).
- `DriveBreadcrumb.tsx` (edit): `variant="icons"` — house root ("All files" when alone),
  `FolderOpen` in `text-colorInfo` per folder, `DriveTypeMark` mini for a file leaf, leaf weight
  500. Default variant unchanged (`@agenta/chat`'s file palette renders it).
- `DriveTypeMark.tsx` (new): page outline + kind chip in `driveKindTone` colours, sizes `tile`
  (56px), `mini` (16px), `badge` (text chip). Used by the tile, list row, tree row, breadcrumb
  leaf, row-2 badge. `driveFileIcon` stays for the chat rail / pills.
- `DriveToolbar.tsx` → **row 2** (36px) in the content column: `variant: "folder" | "markdown" |
  "other"` + slots. Search leaves it.
- `DriveTreePane.tsx` (edit): two header slots — `contentHeader` (row 2) above the content column
  and `railHeader` (36px, the search `InputAffix` with clear ×) above the rows, sharing one bottom
  hairline. Widths / drag / motion unchanged.
- `DriveTreeRow.tsx` (edit): 28px rows, indent `6 + depth × 12`, Phosphor `Folder` / `FolderOpen`
  in `text-colorInfo`, `DriveTypeMark` mini for files, selected = soft fill + weight 500, no size
  suffix. Virtualiser, keyboard nav, drop targets, upload status unchanged.
- `DriveExplorerSkeleton.tsx` (edit): `ChromeSkeleton` mirrors row 1 (48) / row 2 (36) / rail
  header (36) and honours `mirrored` (it does not today).

`web/mobile/src/features/chat/SessionTabs.tsx` (edit): the files toggle always renders (also in
Chat-maximised mode, where the pane can be open today with no control); lucide `PanelRight`
filled when open / outline when closed; `onClick={toggle}`; tooltip "Hide files" / "Show files" +
the existing `panel.files` keys. `SessionWorkspace.tsx` passes `closeControl="none"`.

### Step B — Folder content: Finder grid, list view, sort, empty state

- `driveSort.ts` (entities, new, pure): `sortDriveEntries(nodes, sort)` — folders first via
  `sortLevel`, then name / `modifiedAt` desc (folders, which have none, keep name order) / size
  desc. Unit test.
- `FolderView.tsx` (edit): takes `view` + `sort`; sorts `entries`; renders `VirtualTileGrid`
  (grid) or `ListTable` (list); empty state = Phosphor `Folder` outline, "Nothing here", "Drop
  files to upload, or use Upload." (also when a search matches nothing). Drop-to-upload, staged /
  upload tiles, reveal stagger stay.
- `FolderTile.tsx` + `DriveFileRow.tsx` `tile` variant (edit): no card border / background; 56px
  `DriveTypeMark` / folder glyph; 12px name (2-line clamp, centred); 11px muted size or "N items";
  hover / selected soft fill, radius 8. Grid `minColumnWidth` 132, gaps 4 / 8. `FileThumb` leaves
  the drive grid (design: type marks); it stays for the chat rail `card` variant.
- `ListTable.tsx` (`@agenta/ui`, edit): `wrapRow?: (row, rowNode) => ReactNode` — the row div is
  passed through the wrapper so the drive can put `DriveItemContextMenu` (a `ContextMenuTrigger
  asChild`) around it without breaking the grid. Default = identity; sessions / automations
  untouched.
- List view = `ListTable` with columns `20px minmax(160px,2fr) 92px 84px 92px 28px` (mark, Name,
  Type = `fileTypeLabel` / "Folder", Size / "N items", Modified = `relativeTime(modifiedAt)`,
  download icon → `useDriveItemDownload`), `onOpenRow` → `select`, `density="compact"`,
  `stickyHeader` (the content column is the scroller), `minWidth` 420. Not virtualised — a very
  large folder in list mode renders every row; grid mode stays virtualised. Accepted.
- Row 2 `folder`: grid / list `Segmented` (icon-only) · Sort dropdown (checkmark) · spacer · `⋯`
  (New folder · New file · Upload files… · ─ · Download all (.zip)).

### Step C — Write actions

`@agenta/entities/src/drive`
- `useMountUpload.ts` (edit): extract `refreshMountListing(queryClient, mountId, projectId)`.
- `driveWrites.ts` (new): `createMountFolder` / `deleteMountPath` via Fern
  `getMountsClient()`; `saveMountText(mount, path, text)` = `uploadMountFile` with a `File` built
  from the text; file-only `renameMountFile` / `duplicateMountFile` / `moveMountFile` =
  `fetchMountFileBlob` → `uploadMountFile` → Fern delete (duplicate skips the delete). All call
  `refreshMountListing` + invalidate the session drive summary.
- Gate: one `canWrite` = the existing upload gate (`isAgentFileUploadsEnabled() && !explicitFiles
  && drive.mount`, `useDriveUploads.ts:69`). Delete is disabled on the root and on the
  `agent-files` fold point (a delete there would remove the whole agent mount prefix).

`@agenta/entity-ui/src/drive`
- `useDriveWrites.ts` (new): the actions bound to `drive.resolveMount` + `message` toasts +
  busy flags; delete goes through `modal.confirm` (folder copy states the item count).
- `DriveNameDialog.tsx` (new): one `Dialog` for New folder / New file / Rename / Duplicate /
  Move to… (name or path input; Move pre-fills the current folder). Validates non-empty, no `/` in
  a name, no `..`, no sibling clash (`nodeByPath`).
- `DriveItemContextMenu.tsx` (edit): + Rename · Duplicate · Move to… · ─ · Delete for files;
  folders: Delete only, Rename / Move disabled with tooltip "Folders can't be renamed yet".
- `DriveExplorer.tsx` (edit): owns the dialog state; after create → select the new item (a new
  `.md` opens in the editor); after delete → select the parent; after rename / move → select the
  new path (history entry replaced). Both "Upload files…" items click the existing hidden
  `<input type=file>`.

### Step D — Markdown editor

- `useDriveFileEditor.ts` (entities, new): drafts in an `atomFamily` keyed `${mountId}:${path}`
  over `mountFileContentQueryFamily`; `value`, `setValue`, `dirty`, `save()` (→ `saveMountText`,
  then refetch the text query + recents, clear the draft), `revert()`, `saving`. **Dirty keys off
  user edits, not a string compare**: the editor's first emitted serialisation after (re)seed is
  the baseline, so Lexical's markdown normalisation of an agent-written file never reads as an
  edit. Drafts outlive `DriveExplorer` (module atoms), so leaving a dirty file keeps it — no
  Save / Discard prompt (none in the artifact). `anyDriveDraftDirtyAtom` feeds a host-level
  `useDriveDirtyGuard` (`beforeunload`) mounted in `/m`'s `SessionWorkspace`. Pure draft logic
  in `driveDraft.ts`, unit-tested; the hook stays thin. `explicitFiles` (attachment viewer) mode
  is read-only.
- `MarkdownToolbar.tsx` (`@agenta/ui`, edit): `layout?: "default" | "inline"` — `inline`
  renders H1 / H2 / H3 as buttons (same `$setBlocksType` heading commands the dropdown uses) and
  adds strikethrough (`FORMAT_TEXT_COMMAND` "strikethrough"), then the existing bold / italic /
  code / link / lists / quote / table. Default layout unchanged for instructions / skills.
- `MarkdownEditor.tsx` (edit, small): `toolbarContainer?: HTMLElement | null` + `toolbarLayout`
  passthrough — when set, `MarkdownToolbar` portals into it (row 2); portals keep the
  `EditorProvider` context.
- `DriveMarkdownEditor.tsx` (entity-ui, new, `next/dynamic` inside the already-dynamic explorer
  so Lexical loads only when a `.md` opens): wraps `MarkdownEditor` (`hideHeader`, `grow`,
  `bordered={false}`, controlled `view`). Rendered = Markdown mode; source = Plain text mode.
  `drive.save` (`Cmd/Ctrl+S`) registered in the shared shortcuts registry.
- Row 2 `markdown`: toolbar portal slot (Plain text → label "Plain text · formatting off") ·
  spacer · nothing when clean / `Revert` + `Save` (primary) when dirty · hairline · mode dropdown
  ("Markdown — rendered" / "Plain text — source", persisted) · `⋯` (Rename · Duplicate · Move
  to… · ─ · Delete).
- Row 2 `other`: `DriveTypeMark` badge + "`<fileTypeLabel>` · preview" · spacer · `⋯`. Body =
  the existing kind renderers.
- Preview coverage (`driveKinds.ts` + `renderers.tsx`, mapping only, no new deps):
  extensionless / dot files (`Dockerfile`, `Makefile` → code; `LICENSE`, `README`, `.gitignore`,
  `.editorconfig`, `.env.*` → text); `.tsv` → CSV body with a tab delimiter (`parseCsv` gets a
  delimiter arg); `.jsonl` / `.ndjson` → text; `.ipynb` → JSON code view; code langs `vue`,
  `svelte`, `astro`, `dart`, `scala`, `lua`, `r`, `pl`, `ps1`, `bat`, `graphql`, `proto`, `tf`,
  `less`, `sass`, `rst`, `conf`, `cfg`; audio `aac`, `opus`, `weba`; video `m4v`, `ogv`.
  `driveKindTone` covers the new kinds so tiles / rows / badges stay marked. Unit test on
  `resolveDriveFileKind`. `docx` / `xlsx` / `zip` / `pptx` stay on the download card (decided).
- `web/mobile/src/features/app/ContextSync.tsx` (edit): `registerDriveMarkdown` with
  `ChatMarkdown` + the `AssistantMarkdown` prose classes (exported from that file) so the drive's
  non-editable rendered markdown (quick look, other hosts) matches the chat.

### Step E — States, stories, tests, gate

- Storybook (`web/storybook/stories/entity-ui/`): `DriveChrome.stories.tsx` — row 1 / row 2
  variants (folder, markdown clean / dirty, other), the tile, the list row, the type mark, the
  empty state, with static props. Gate: `pnpm --filter @agenta/storybook lint` + build.
- Tests (vitest `tests/unit/`): `driveHistory`, `driveSort`, `driveDraft`, `driveKindTone`
  (entities, pure); `SessionTabs` toggle state (mobile render test).
- `pnpm lint-fix` in `web/`; `pnpm --filter @agenta/mobile types:check`;
  `pnpm turbo run build --filter=@agenta/entities --filter=@agenta/entity-ui --filter=@agenta/ui`.

## Deliberately not doing

"Previous versions" / "Show file history" (no version store); phone (<768px) files pane (none
today; the design is a 1440 board); folder rename / move; drag-to-move between folders; new chords
beyond `panel.files` + `drive.save`; details / repo-facts surface in the chrome (removed by the
design); backend changes; desktop verification.

## Verification (on `/m`, 1440 and 1024 wide, light + dark)

1. Open an agent session with a live sandbox (the "demo shoot" mount listing hangs on the local
   stack — use one whose mount answers). Toggle the pane from the session bar in both Build and
   Chat-maximised modes: icon filled / outline; chat takes the width when closed.
2. Row 1: `‹ ›` after navigating (incl. a chat "Wrote a file" link); breadcrumb icons; path `⋯`
   copy / download / upload; view options toggle hidden + git-ignored (+ temporary on a
   mixed-origin drive); tree toggle removes the rail + search.
3. Row 2 folder: grid ↔ list persists across reload; sort name / modified / size; `⋯` New folder /
   New file create and select; Download all streams a zip.
4. Tiles / list rows: hover fill, open on click, right-click menu; empty folder state; search
   filters tree + content, "No matches" in the rail; a dotfile upload reveals without changing
   the persisted hidden-files pref.
5. Writes: rename / duplicate / move a file, delete a file and a folder (confirm), upload from
   both menus; toasts; listing refreshes without reload; Delete disabled on root / `agent-files`.
6. Markdown: open `.md` — no dirty flag on open; edit in rendered mode with the toolbar; Revert /
   Save; `Cmd+S`; switch to Plain text and back; navigate away and back (draft kept); reload
   shows the saved content; a dirty draft prompts on tab close.
7. Other files: badge + "`<Type>` · preview" row, existing renderers (image / pdf / code / csv).
8. Overlay drawers on `/m` (config pane Files, agent overview drive card) still open / close /
   expand with the new chrome; skeleton geometry matches; dark mode.
