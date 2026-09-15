/**
 * DriveExplorer — the heavy browsing body of the drive surfaces: row 1 (history · breadcrumb · path
 * actions · view options · tree toggle), row 2 (the context toolbar for a folder, a markdown file or
 * any other file), the tree rail with its search, and the kind-matched content: the folder grid or
 * list, the markdown editor, or a read-only preview. Split into its OWN module so the shells can
 * `next/dynamic`-import it: the tree/renderer/pdfjs/markdown graph then loads only when a drawer
 * actually opens, never with the always-mounted config panel or chat pane.
 *
 * The ONE body for BOTH hosts — the config panel drawer and the chat pane (chrome mode: rows 1 + 2
 * + the rail search). Also embeddable headerless.
 *
 * This module is the COMPOSITION ROOT: every concern below it lives in a sibling hook — selection +
 * history + persistence ({@link useDriveSelection}), filters + view prefs ({@link useDriveFilters}),
 * uploads + the staged inbox ({@link useDriveUploads}), the writes ({@link useDriveWrites}), the
 * markdown draft ({@link useDriveFileEditor}), the lazy tree pipeline ({@link useDriveTreeData}),
 * the pane geometry ({@link useDriveTreePane}), the scroll viewport + virtualizer
 * ({@link useDriveTreeViewport}), the per-group horizontal scroll ({@link useTreeGroupScroll}),
 * keyboard nav ({@link useDriveTreeKeyboard}), selection reveal ({@link useDriveTreeReveal}) and
 * "Download all" ({@link useDriveDownloadAll}).
 */
import {type ReactNode, useCallback, useMemo, useRef, useState} from "react"

import {looksLikeFilePath} from "@agenta/entities/drive"
import {type DriveId, type DriveScope} from "@agenta/entities/drive"
import {type DroppedFile} from "@agenta/entities/drive"
import {
    type DriveFileKind,
    filterDriveTree,
    isMarkdownPath,
    resolveDriveFileKind,
} from "@agenta/entities/drive"
import {
    DRIVE_CODE_EDIT_CAP,
    DRIVE_MARKDOWN_EDIT_CAP,
    useDriveFileEditor,
} from "@agenta/entities/drive"
import {useDriveFilters} from "@agenta/entities/drive"
import {useDriveSelection} from "@agenta/entities/drive"
import {useDriveTreeKeyboard} from "@agenta/entities/drive"
import {useDriveTreePane} from "@agenta/entities/drive"
import {useDriveTreeReveal} from "@agenta/entities/drive"
import {useDriveTreeViewport} from "@agenta/entities/drive"
import {useDriveUploads} from "@agenta/entities/drive"
import {type SessionDriveData} from "@agenta/entities/drive"
import {useTreeGroupScroll} from "@agenta/entities/drive"
import {TREE_WIDTH_COMPACT} from "@agenta/entities/drive"
import {type MountFile} from "@agenta/entities/session"
import {projectIdAtom} from "@agenta/shared/state"
import {InputAffix as Input} from "@agenta/ui/ui"
import {Code, Eye, MagnifyingGlass} from "@phosphor-icons/react"
import {useAtomValue} from "jotai"
import dynamic from "next/dynamic"

import {driveRootLabel} from "./DriveBreadcrumb"
import {DriveExplorerSkeleton} from "./DriveExplorerSkeleton"
import {DriveEmptyState, DriveErrorState} from "./DriveExplorerStates"
import {DriveFilePreview} from "./DriveFilePreview"
import {DriveHeader} from "./DriveHeader"
import {
    type DriveItemWriteActions,
    useCopyDrivePath,
    useCopyText,
    useDriveItemDownload,
} from "./DriveItemContextMenu"
import {DriveNameDialog, type DriveNameDialogRequest, validateDriveName} from "./DriveNameDialog"
import {type DriveFileActions, DriveToolbar} from "./DriveToolbar"
import {DriveTreeList} from "./DriveTreeList"
import {DriveTreePane} from "./DriveTreePane"
import {TreeRow} from "./DriveTreeRow"
import {FolderView} from "./FolderView"
import {DriveHtmlPreview} from "./renderers"
import {useDriveDownloadAll} from "./useDriveDownloadAll"
import {useDriveTreeData} from "./useDriveTreeData"
import {useDriveWrites} from "./useDriveWrites"
import {useUploadReveal} from "./useUploadReveal"

export type {DriveId, DriveScope} from "@agenta/entities/drive"

// The Lexical editor graph is heavy and only an editable file needs it.
const DriveMarkdownEditor = dynamic(
    () => import("./DriveMarkdownEditor").then((m) => m.DriveMarkdownEditor),
    {ssr: false},
)
const DriveCodeEditor = dynamic(() => import("./DriveCodeEditor").then((m) => m.DriveCodeEditor), {
    ssr: false,
})
/** The kinds the code editor takes: source, JSON / YAML, plain text, HTML (with a Preview mode in
 * row 2). Markdown has its own editor. */
const CODE_EDIT_KINDS = new Set<DriveFileKind>(["code", "json", "text", "html"])

const parentPath = (path: string) => path.slice(0, Math.max(0, path.lastIndexOf("/")))
const noop = () => undefined
/** The rail's static root row — always open; selecting it lands on the root folder. */
const ROOT_NODE = {name: "All files", path: "", isFolder: true, children: []}

/**
 * The browsing body — loading/empty/error states + the two-pane search/tree/preview. Owns its
 * selection state; initialize with `initialPath` (callers remount per open, so mount-time init
 * is the reset).
 */
export function DriveExplorer({
    drive,
    explicitFiles,
    scope = "session",
    initialPath,
    chrome: chromeProp,
    onClose,
    driveIds,
    expanded: drawerExpanded = false,
    onToggleExpand,
    stagedFiles,
    onStagedChange,
    mirrored = false,
    initialShowTree = true,
    closeVariant = "close",
}: {
    drive: SessionDriveData
    /** Render this flat list instead of the mount's lazy-loaded tree — the local-file mode used to
     * preview composer attachments. When set, the mount tree and its loading states are bypassed;
     * bytes come from a `DriveFileSourceContext` (see `driveFileSource`) rather than downloads. */
    explicitFiles?: MountFile[]
    scope?: DriveScope
    initialPath?: string | null
    /** Render the explorer's own chrome (rows 1 + 2 and the rail search). Defaults to "a close
     * handler was given" — the drawer hosts always pass one; the docked pane passes `chrome` alone
     * when the session bar owns the toggle. */
    chrome?: boolean
    /** Row 1's close: an "×" (overlay drawer) or a "»" collapse (desktop docked pane). */
    onClose?: () => void
    /** Raw ids for the path menu (drive id + session/agent id) — the inspector affordance. */
    driveIds?: DriveId[]
    /** The host drawer is at expanded (near-full) width — reflected by row 1's expand toggle. */
    expanded?: boolean
    onToggleExpand?: () => void
    /** Files dropped on a recents peek, staged (unwritten) until the user picks a destination folder
     * and clicks "Upload here" — shown as ghost tiles in the grid. The host owns the list. */
    stagedFiles?: DroppedFile[]
    onStagedChange?: (files: DroppedFile[]) => void
    /** Mirror the two-pane body: tree docked RIGHT, content LEFT (the in-chat Files pane). */
    mirrored?: boolean
    /** Open with the tree collapsed — a single-file quick look; the row-1 toggle reveals it. */
    initialShowTree?: boolean
    closeVariant?: "close" | "collapse"
}) {
    const chrome = chromeProp ?? onClose != null
    const rootLabel = driveRootLabel(drive.mount)
    const {
        search,
        setSearch,
        deferredSearch,
        searchActive,
        showTemporary,
        setShowTemporary,
        showHidden,
        setShowHidden,
        toggleShowHiddenPref,
        showGitignored,
        setShowGitignored,
        toggleShowGitignoredPref,
        view,
        setView,
        sort,
        setSort,
        editorMode,
        setEditorMode,
    } = useDriveFilters()
    const {
        persistedSelection,
        selectedPath,
        select,
        replaceSelection,
        expanded,
        setExpanded,
        goBack,
        goForward,
        canGoBack,
        canGoForward,
    } = useDriveSelection({mountId: drive.mount?.id ?? "", initialPath})

    const copyPath = useCopyDrivePath()
    const download = useDriveItemDownload(drive)
    const copyText = useCopyText()
    const projectId = useAtomValue(projectIdAtom)
    const pane = useDriveTreePane({
        searchActive,
        mirrored,
        initialWidth: mirrored ? TREE_WIDTH_COMPACT : undefined,
        initialShow: initialShowTree,
    })
    const {toggleTree, treeVisible, treeShift} = pane
    const {archiveMounts, downloadingAll, handleDownloadAll} = useDriveDownloadAll({
        drive,
        projectId,
    })

    // Uploads sit ABOVE the tree, but a finished upload is only explainable AGAINST the tree (is the
    // file in the listing, or did a filter swallow it?) — so the completion callback forwards through
    // a ref that useUploadReveal fills in once both halves exist.
    const revealUpload = useRef<(path: string) => void>(() => undefined)
    const onUploaded = useCallback((path: string) => revealUpload.current(path), [])
    const {
        canUpload,
        uploadInputRef,
        uploadFiles,
        pendingUploadByPath,
        uploadIntoFolder,
        drop,
        staged,
        stagedItems,
        removeStaged,
        retryUpload,
        dismissUpload,
    } = useDriveUploads({drive, explicitFiles, select, stagedFiles, onStagedChange, onUploaded})

    const {
        lazyTree,
        showOrigin,
        inGitScope,
        tree,
        shownTree,
        shownExpanded,
        isDirLoading,
        flatRows,
        indexByPath,
        justLoadedDirs,
        firstEverPaths,
        nodeByPath,
    } = useDriveTreeData({
        drive,
        explicitFiles,
        uploadFiles,
        expanded,
        selectedPath,
        searchActive,
        deferredSearch,
        showTemporary,
        showHidden,
        showGitignored,
    })
    // Closes the loop opened above: a completed upload toasts, and anything the filters would have
    // hidden (a dotfile, a git-ignored `.env`) reveals itself instead of blinking out. The reveal
    // writes the SESSION toggles only — never the persisted preference.
    revealUpload.current = useUploadReveal({
        files: lazyTree.files,
        loadedDirs: lazyTree.loadedDirs,
        fetchingDirs: lazyTree.fetchingDirs,
        inGitScope,
        showHidden,
        setShowHidden,
        showGitignored,
        setShowGitignored,
    })
    const selectedNode = selectedPath != null ? nodeByPath.get(selectedPath) : undefined
    // The root and any node flagged a folder render the grid; everything else the preview. In lazy
    // mode a not-yet-loaded selection is treated as a FILE (the preview reads by path), so an initial
    // file target shows its preview immediately instead of a wrong "empty folder" flash.
    const selectedIsFolder = selectedPath === "" || selectedNode?.isFolder === true

    // Where an upload lands: the selection when it's a folder, else the selected file's folder.
    const currentFolder = selectedIsFolder ? (selectedPath ?? "") : parentPath(selectedPath ?? "")
    const commitStaged = useCallback(() => {
        if (!staged.length) return
        uploadIntoFolder(staged, currentFolder)
        onStagedChange?.([])
    }, [staged, currentFolder, uploadIntoFolder, onStagedChange])
    const openUploadPicker = useCallback(() => uploadInputRef.current?.click(), [uploadInputRef])

    const selected = drive.recents.find((f) => f.path === selectedPath) ?? null
    const selectedResolved = selectedPath ? drive.resolveMount(selectedPath) : null
    const selectedMount = selectedResolved?.mount ?? drive.mount
    const selectedMountPath = selectedResolved?.path ?? selectedPath ?? ""
    const selectedFileSize = selected?.size ?? selectedNode?.size ?? undefined

    // ---- Writes (create / rename / duplicate / delete) ------------------------------------------
    // Same gate as uploads: a writable, real mount (never the local-file attachment viewer).
    const canWrite = canUpload
    const writes = useDriveWrites(drive)
    const [nameRequest, setNameRequest] = useState<DriveNameDialogRequest | null>(null)
    const siblingsOf = useCallback(
        (folder: string) =>
            (folder === "" ? tree : (nodeByPath.get(folder)?.children ?? [])).map((n) => n.name),
        [tree, nodeByPath],
    )
    const requestName = useCallback(
        (kind: DriveNameDialogRequest["kind"], path: string) =>
            setNameRequest({
                kind,
                path,
                siblings: siblingsOf(kind.startsWith("new") ? path : parentPath(path)),
            }),
        [siblingsOf],
    )
    const onNameSubmit = useCallback(
        async (req: DriveNameDialogRequest, value: string) => {
            let ok = false
            let landed: string | null = null
            switch (req.kind) {
                case "new-folder":
                    ok = await writes.createFolder(req.path, value)
                    landed = req.path ? `${req.path}/${value}` : value
                    break
                case "new-file":
                    ok = await writes.createFile(req.path, value)
                    landed = req.path ? `${req.path}/${value}` : value
                    break
                case "rename":
                    ok = await writes.rename(req.path, value)
                    landed = parentPath(req.path) ? `${parentPath(req.path)}/${value}` : value
                    break
                case "duplicate":
                    ok = await writes.duplicate(req.path, value)
                    landed = parentPath(req.path) ? `${parentPath(req.path)}/${value}` : value
                    break
            }
            if (!ok) return
            setNameRequest(null)
            if (landed == null) return
            // A rename keeps its place in history; a new item is a real step.
            if (req.kind === "rename" && req.path === selectedPath) replaceSelection(landed)
            else select(landed)
        },
        [writes, selectedPath, replaceSelection, select],
    )
    const onDelete = useCallback(
        async (path: string, isFolder: boolean) => {
            if (!writes.canDelete(path)) return
            const node = nodeByPath.get(path)
            const ok = await writes.remove(path, isFolder, node?.itemCount ?? node?.children.length)
            if (!ok) return
            // The selection (or something above it) is gone — land on the parent folder.
            if (
                selectedPath != null &&
                (selectedPath === path || selectedPath.startsWith(`${path}/`))
            )
                select(parentPath(path))
        },
        [writes, nodeByPath, selectedPath, select],
    )
    const itemWrites = useMemo<DriveItemWriteActions | undefined>(
        () =>
            canWrite
                ? {
                      onRename: (path) => requestName("rename", path),
                      onDuplicate: (path) => requestName("duplicate", path),
                      onDelete: (path, isFolder) => void onDelete(path, isFolder),
                  }
                : undefined,
        [canWrite, requestName, onDelete],
    )
    const fileActions = useMemo<DriveFileActions | undefined>(
        () =>
            canWrite && selectedPath && !selectedIsFolder
                ? {
                      onRename: () => requestName("rename", selectedPath),
                      renameTo: async (name) => {
                          const ok = await writes.rename(selectedPath, name)
                          const parent = parentPath(selectedPath)
                          if (ok) replaceSelection(parent ? `${parent}/${name}` : name)
                          return ok
                      },
                      validateName: (name) =>
                          validateDriveName("rename", name, {
                              kind: "rename",
                              path: selectedPath,
                              siblings: siblingsOf(parentPath(selectedPath)),
                          }),
                      onDuplicate: () => requestName("duplicate", selectedPath),
                      onDelete: () => void onDelete(selectedPath, false),
                  }
                : undefined,
        [
            canWrite,
            selectedPath,
            selectedIsFolder,
            requestName,
            onDelete,
            writes,
            replaceSelection,
            siblingsOf,
        ],
    )

    // ---- File editing (markdown / code) --------------------------------------------------------
    const editableFile = chrome && canWrite && !selectedIsFolder && !!selectedPath
    // Over the caps a file opens read-only (the preview) — see the caps for the numbers.
    const markdownKind = editableFile && isMarkdownPath(selectedPath)
    const codeKind =
        editableFile && !markdownKind && CODE_EDIT_KINDS.has(resolveDriveFileKind(selectedPath))
    const editableMarkdown = markdownKind && (selectedFileSize ?? 0) <= DRIVE_MARKDOWN_EDIT_CAP
    const editableCode = codeKind && (selectedFileSize ?? 0) <= DRIVE_CODE_EDIT_CAP
    const tooLargeToEdit = (markdownKind || codeKind) && !editableMarkdown && !editableCode
    // An editable HTML file: its source in the code editor, or the rendered document (row 2 switches).
    const htmlKind = editableCode && resolveDriveFileKind(selectedPath) === "html"
    const [htmlView, setHtmlView] = useState<"source" | "preview">("source")
    const htmlPreview = htmlKind && htmlView === "preview"
    const editing = editableMarkdown || editableCode
    const editor = useDriveFileEditor(
        editing ? selectedMount : null,
        editing ? selectedMountPath : "",
    )
    // Row 2's slot for the editor's formatting bar; the editor portals into it.
    const [toolbarEl, setToolbarEl] = useState<HTMLDivElement | null>(null)
    // Cmd/Ctrl+S (and Retry) write now; autosave covers the rest and row 2 shows the state.
    const onSave = useCallback(() => void editor.save(), [editor])

    const {onMeasureContent, scrollXFor, attachTreeWheel} = useTreeGroupScroll({
        deferredSearch,
        showGitignored,
    })
    const {treeVirtualizer, measureRow, treeScrollRef, focusTreeRow} = useDriveTreeViewport({
        flatRows,
        indexByPath,
        selectedPath,
        rootLoading: lazyTree.rootLoading,
        attachTreeWheel,
    })
    useDriveTreeReveal({selectedPath, selectedIsFolder, setExpanded, indexByPath, treeVirtualizer})
    const onTreeKeyDown = useDriveTreeKeyboard({
        flatRows,
        indexByPath,
        nodeByPath,
        expanded,
        setExpanded,
        focusTreeRow,
    })

    // Row 2's read-side actions on the selection: copy its path (none at the root), download the
    // file's bytes, a folder as a scoped zip, or the whole drive at the root.
    const onCopyCurrentPath = selectedPath ? () => copyText(selectedPath, "Path copied") : undefined
    const onDownloadCurrent =
        selectedPath === "" || selectedPath == null
            ? archiveMounts.length
                ? handleDownloadAll
                : undefined
            : () => download(selectedPath, selectedIsFolder)

    // Only a TOTAL failure blanks the drawer. A partial failure — the artifact-scoped agent mount
    // erroring while the session's own files loaded (or vice-versa) — still has a tree to browse, so
    // it falls through and renders the tree; its retry rides row 1 (see DriveHeader's
    // `partialErrored` slot), NOT a new banner row that would shove the content down.
    let body: ReactNode
    if (drive.errored && drive.fileCount === 0) {
        body = <DriveErrorState drive={drive} />
    } else if (drive.isLoading || (drive.mount && lazyTree.rootLoading)) {
        // The right pane will be a FILE preview if we're opening onto a file, else the browse GRID.
        // Nothing is loaded yet, so the name is all we have to go on.
        const target = initialPath ?? persistedSelection
        const isFilePreview = target ? looksLikeFilePath(target) : false
        body = (
            <DriveExplorerSkeleton
                mode={isFilePreview ? "preview" : "grid"}
                showTree={treeVisible}
                mirrored={mirrored}
            />
        )
    } else if (drive.fileCount === 0) {
        body = <DriveEmptyState scope={scope} />
    } else {
        // Row 2 follows the selection: folder toolbar, markdown editor toolbar, or the preview label.
        const contentHeader = !chrome ? null : selectedIsFolder ? (
            <DriveToolbar
                variant="folder"
                view={view}
                setView={setView}
                sort={sort}
                setSort={setSort}
                actions={
                    canWrite
                        ? {
                              onNewFolder: () => requestName("new-folder", selectedPath ?? ""),
                              onNewFile: () => requestName("new-file", selectedPath ?? ""),
                              onUpload: staged.length ? commitStaged : openUploadPicker,
                              stagedCount: staged.length,
                          }
                        : undefined
                }
                onCopyPath={onCopyCurrentPath}
                onDownloadAll={onDownloadCurrent}
                downloadingAll={downloadingAll}
            />
        ) : editableMarkdown ? (
            <DriveToolbar
                variant="markdown"
                toolbarRef={setToolbarEl}
                mode={editorMode}
                setMode={setEditorMode}
                status={editor.status}
                onRetry={onSave}
                actions={fileActions}
                onCopyPath={onCopyCurrentPath}
                onDownload={onDownloadCurrent}
            />
        ) : (
            <DriveToolbar
                variant="other"
                path={selectedPath ?? ""}
                actions={fileActions}
                draft={editableCode ? {status: editor.status, onRetry: onSave} : undefined}
                note={tooLargeToEdit ? "Read-only · too large to edit here" : undefined}
                mode={
                    htmlKind
                        ? {
                              value: htmlView,
                              onChange: (v) => setHtmlView(v as "source" | "preview"),
                              options: [
                                  {
                                      value: "source",
                                      label: "Source",
                                      icon: <Code className="size-3.5" />,
                                  },
                                  {
                                      value: "preview",
                                      label: "Preview",
                                      icon: <Eye className="size-3.5" />,
                                  },
                              ],
                          }
                        : undefined
                }
                onCopyPath={onCopyCurrentPath}
                onDownload={onDownloadCurrent}
            />
        )

        // What shows for the current selection: the folder's children (grid / list), the markdown
        // editor, or a file's preview. The content column of the tree navigator (and the whole body
        // when the tree is hidden).
        const contentPane =
            selectedPath == null ? (
                <div className="flex h-full flex-1 items-center justify-center text-xs text-colorTextTertiary">
                    Select a file to preview it.
                </div>
            ) : selectedIsFolder ? (
                <FolderView
                    folderPath={selectedPath}
                    // A search narrows the content too: matching files, and folders holding one.
                    nodes={
                        selectedPath === ""
                            ? searchActive
                                ? shownTree
                                : tree
                            : searchActive
                              ? filterDriveTree(selectedNode?.children ?? [], deferredSearch)
                              : (selectedNode?.children ?? [])
                    }
                    rootLabel={rootLabel}
                    drive={drive}
                    view={view}
                    sort={sort}
                    selectedPath={selectedPath}
                    writes={itemWrites}
                    loading={
                        selectedPath !== "" &&
                        !searchActive &&
                        !lazyTree.loadedDirs.has(selectedPath)
                    }
                    // Chrome mode: rows 1 + 2 own the breadcrumb / actions, so the pane drops its
                    // own header band and just shows the grid.
                    hideHeader={chrome}
                    // With the tree hidden, the folder grid is the only nav surface → focus its first
                    // tile on open. With the tree shown, the tree owns focus, so don't.
                    autoFocus={!treeVisible}
                    anticipateShift={treeShift}
                    onSelect={select}
                    drop={canUpload ? drop : undefined}
                    // Uploads are injected into the tree under their folder; decorate the matching node.
                    pendingUploadByPath={pendingUploadByPath}
                    onRetryUpload={retryUpload}
                    onDismissUpload={dismissUpload}
                    stagedItems={stagedItems}
                    onRemoveStaged={removeStaged}
                />
            ) : editableMarkdown ? (
                <DriveMarkdownEditor
                    mount={selectedMount}
                    path={selectedMountPath}
                    mode={editorMode}
                    toolbarContainer={toolbarEl}
                    loading={editor.loading}
                    failed={editor.failed}
                    onSave={onSave}
                />
            ) : htmlPreview ? (
                <DriveHtmlPreview
                    mount={selectedMount}
                    path={selectedMountPath}
                    displayPath={selectedPath}
                    onNavigate={select}
                />
            ) : editableCode ? (
                <DriveCodeEditor
                    mount={selectedMount}
                    path={selectedMountPath}
                    loading={editor.loading}
                    failed={editor.failed}
                    onSave={onSave}
                />
            ) : (
                <DriveFilePreview
                    // Preview reads from the file's own mount (cwd or the nested agent-files mount),
                    // but the breadcrumb/name show the presented path (agent-files/ prefix).
                    mount={selectedMount}
                    path={selectedMountPath}
                    displayPath={selectedPath}
                    showOrigin={showOrigin}
                    rootLabel={rootLabel}
                    touchedAt={selected?.touchedAt}
                    size={selected?.size ?? undefined}
                    hideHeader={chrome}
                    onSelect={select}
                />
            )
        body = (
            <DriveTreePane
                pane={pane}
                mirrored={mirrored}
                treeScrollRef={treeScrollRef}
                onTreeKeyDown={onTreeKeyDown}
                treeDropProps={canUpload ? drop.containerDropProps(currentFolder) : undefined}
                contentHeader={contentHeader}
                railHeader={
                    chrome ? (
                        <Input
                            allowClear
                            size="sm"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            placeholder="Search files"
                            className="w-full"
                            prefix={
                                <MagnifyingGlass size={12} className="text-colorTextQuaternary" />
                            }
                        />
                    ) : null
                }
                rows={
                    <DriveTreeList
                        flatRows={flatRows}
                        searchLoading={lazyTree.searchLoading}
                        treeVirtualizer={treeVirtualizer}
                        measureRow={measureRow}
                        justLoadedDirs={justLoadedDirs}
                        firstEverPaths={firstEverPaths}
                        shownExpanded={shownExpanded}
                        selectedPath={selectedPath}
                        showOrigin={showOrigin}
                        isDirLoading={isDirLoading}
                        scrollXFor={scrollXFor}
                        onMeasureContent={onMeasureContent}
                        canUpload={canUpload}
                        drop={drop}
                        pendingUploadByPath={pendingUploadByPath}
                        onRetryUpload={retryUpload}
                        onDismissUpload={dismissUpload}
                        setExpanded={setExpanded}
                        select={select}
                        copyPath={copyPath}
                        download={download}
                        writes={itemWrites}
                        depthOffset={chrome && !searchActive ? 1 : 0}
                        rootRow={
                            chrome && !searchActive ? (
                                <TreeRow
                                    node={ROOT_NODE}
                                    depth={0}
                                    isOpen
                                    selected={selectedPath === ""}
                                    parent=""
                                    scrollX={0}
                                    onMeasureContent={noop}
                                    onToggle={noop}
                                    onSelect={select}
                                />
                            ) : null
                        }
                    />
                }
            >
                {contentPane}
            </DriveTreePane>
        )
    }
    // The lazy per-directory subscribers render alongside EVERY branch (skeleton/empty/tree) so the
    // root query fires even while the skeleton shows — otherwise the drawer would never leave loading.
    return (
        <>
            {lazyTree.subscribers}
            {chrome ? (
                <div className="flex h-full min-h-0 w-full flex-col">
                    <DriveHeader
                        selectedPath={selectedPath}
                        isFolder={selectedIsFolder}
                        rootLabel={rootLabel}
                        onNavigate={select}
                        canGoBack={canGoBack}
                        canGoForward={canGoForward}
                        onBack={goBack}
                        onForward={goForward}
                        copyText={copyText}
                        ids={driveIds ?? []}
                        showOrigin={showOrigin}
                        showTemporary={showTemporary}
                        onToggleTemporary={() => setShowTemporary((v) => !v)}
                        showHidden={showHidden}
                        onToggleHidden={toggleShowHiddenPref}
                        inGitScope={inGitScope}
                        showGitignored={showGitignored}
                        onToggleGitignored={toggleShowGitignoredPref}
                        treeVisible={treeVisible}
                        searchActive={searchActive}
                        onToggleTree={toggleTree}
                        onClose={onClose}
                        closeVariant={closeVariant}
                        expanded={drawerExpanded}
                        onToggleExpand={onToggleExpand}
                        partialErrored={drive.partialErrored}
                        onRetry={drive.retry}
                        retrying={drive.isFetching}
                    />
                    <input
                        ref={uploadInputRef}
                        type="file"
                        multiple
                        className="hidden"
                        onChange={(e) => {
                            const picked = e.target.files
                            if (picked?.length)
                                uploadIntoFolder(
                                    Array.from(picked).map((file) => ({
                                        file,
                                        relativePath: file.name,
                                    })),
                                    currentFolder,
                                )
                            e.target.value = ""
                        }}
                    />
                    <div className="flex min-h-0 flex-1 flex-col">{body}</div>
                    <DriveNameDialog
                        request={nameRequest}
                        busy={writes.busy}
                        onSubmit={(req, value) => void onNameSubmit(req, value)}
                        onClose={() => setNameRequest(null)}
                    />
                </div>
            ) : (
                body
            )}
        </>
    )
}
