/**
 * The drive surfaces' browsing body: row 1, row 2, the tree rail and the kind-matched content
 * (folder grid / list, the editors, or a preview). Its own module so hosts `next/dynamic`-import
 * it. A composition root: every concern lives in a sibling hook.
 */
import {type KeyboardEvent, type ReactNode, useCallback, useMemo, useRef, useState} from "react"

import {looksLikeFilePath} from "@agenta/entities/drive"
import {type DriveId, type DriveScope} from "@agenta/entities/drive"
import {type DroppedFile} from "@agenta/entities/drive"
import {
    type DriveFileKind,
    driveNavAction,
    filterDriveTree,
    isEditableTarget,
    joinPath,
    nameOf,
    newDriveName,
    parentOf,
    resolveDriveFileKind,
    validateDriveName,
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
import {agentAppsEnabledAtom, projectIdAtom} from "@agenta/shared/state"
import {InputAffix as Input} from "@agenta/ui/ui"
import {Code, Eye, MagnifyingGlass, Play} from "@phosphor-icons/react"
import {useAtomValue} from "jotai"
import dynamic from "next/dynamic"

import {driveRootLabel} from "./DriveBreadcrumb"
import {DriveEditorSkeleton} from "./DriveEditorFrame"
import {DriveExplorerSkeleton} from "./DriveExplorerSkeleton"
import {DriveEmptyState, DriveErrorState} from "./DriveExplorerStates"
import {DriveFilePreview} from "./DriveFilePreview"
import {type DriveFolderMenuProps} from "./DriveFolderMenu"
import {DriveHeader} from "./DriveHeader"
import {
    type DriveItemWriteActions,
    useCopyDrivePath,
    useCopyText,
    useDriveItemDownload,
} from "./DriveItemContextMenu"
import {type DriveNameEdit} from "./DriveNameField"
import {type DriveFileActions, DriveToolbar} from "./DriveToolbar"
import {DriveTreeList} from "./DriveTreeList"
import {DriveTreePane} from "./DriveTreePane"
import {TreeRow} from "./DriveTreeRow"
import {FolderView} from "./FolderView"
import {DriveHtmlApp} from "./renderers"
import {useDriveDownloadAll} from "./useDriveDownloadAll"
import {useDrivePasteUpload} from "./useDrivePasteUpload"
import {useDriveTreeData} from "./useDriveTreeData"
import {useDriveWrites} from "./useDriveWrites"
import {useSelectionReveal} from "./useSelectionReveal"
import {useUploadReveal} from "./useUploadReveal"

export type {DriveId, DriveScope} from "@agenta/entities/drive"

// The Lexical graph loads only when an editable file opens; the body is a skeleton meanwhile.
const DriveMarkdownEditor = dynamic(
    () => import("./DriveMarkdownEditor").then((m) => m.DriveMarkdownEditor),
    {ssr: false, loading: () => <DriveEditorSkeleton lines={7} />},
)
const DriveCodeEditor = dynamic(() => import("./DriveCodeEditor").then((m) => m.DriveCodeEditor), {
    ssr: false,
    loading: () => <DriveEditorSkeleton lines={8} />,
})
/** The kinds the code editor takes; markdown and plain text share the prose editor. */
const CODE_EDIT_KINDS = new Set<DriveFileKind>(["code", "json", "html"])
const PROSE_KINDS = new Set<DriveFileKind>(["markdown", "text"])

const noop = () => undefined
/** The rail's static root row. */
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
    initialPathSeq,
    chrome: chromeProp,
    onClose,
    driveIds,
    expanded: drawerExpanded = false,
    onToggleExpand,
    stagedFiles,
    onStagedChange,
    mirrored = false,
    initialShowTree = true,
    treePersistKey,
    closeVariant = "close",
}: {
    drive: SessionDriveData
    /** Render this flat list instead of the mount's lazy-loaded tree — the local-file mode used to
     * preview composer attachments. When set, the mount tree and its loading states are bypassed;
     * bytes come from a `DriveFileSourceContext` (see `driveFileSource`) rather than downloads. */
    explicitFiles?: MountFile[]
    scope?: DriveScope
    initialPath?: string | null
    /** Bump to re-open the same `initialPath`. */
    initialPathSeq?: number
    /** Render rows 1 + 2 and the rail search; defaults to "a close handler was given". */
    chrome?: boolean
    /** Row 1's close: "×" (overlay) or "»" (docked). */
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
    /** Tree docked RIGHT, content LEFT (the in-chat Files pane). */
    mirrored?: boolean
    /** Open with the tree collapsed. */
    initialShowTree?: boolean
    /** Remember the tree's shown/hidden state and width across opens under this key. */
    treePersistKey?: string
    closeVariant?: "close" | "collapse" | "back"
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
    } = useDriveSelection({mountId: drive.mount?.id ?? "", initialPath, initialPathSeq})

    const copyPath = useCopyDrivePath()
    const download = useDriveItemDownload(drive)
    const copyText = useCopyText()
    const projectId = useAtomValue(projectIdAtom)
    const pane = useDriveTreePane({
        mirrored,
        initialWidth: mirrored ? TREE_WIDTH_COMPACT : undefined,
        initialShow: initialShowTree,
        persistKey: treePersistKey,
    })
    const {treeVisible, treeShift} = pane
    // The search box lives in the rail: hiding the rail also clears the search it holds.
    const toggleTree = useCallback(() => {
        if (treeVisible && searchActive) setSearch("")
        pane.toggleTree()
    }, [treeVisible, searchActive, setSearch, pane])
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
    // And a selection made outside the tree reveals its hidden or git-ignored home the same way.
    useSelectionReveal({
        selectedPath,
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
    // A link inside a file picks its reading against the tree already in memory — never a fetch.
    const linkExists = useCallback((path: string) => nodeByPath.has(path), [nodeByPath])
    // The root and any node flagged a folder render the grid; everything else the preview. In lazy
    // mode a not-yet-loaded selection is treated as a FILE (the preview reads by path), so an initial
    // file target shows its preview immediately instead of a wrong "empty folder" flash.
    const selectedIsFolder = selectedPath === "" || selectedNode?.isFolder === true

    // Where an upload lands: the selection when it's a folder, else the selected file's folder.
    const currentFolder = selectedIsFolder ? (selectedPath ?? "") : parentOf(selectedPath ?? "")
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

    // Writes share the upload gate: a writable, real mount.
    const canWrite = canUpload
    // The pane's own box: confirms render inside it, not over the whole window.
    const paneRef = useRef<HTMLDivElement>(null)
    const getPane = useCallback(() => paneRef.current, [])
    // ⌘V with the pane current: the clipboard's files land in the folder being viewed.
    // A pasted bitmap's name is dated to the second, so the destination has to be asked whether a
    // name is free: the folder's own listing, plus the names handed out since (an upload from a
    // paste one second ago may not be in the tree yet).
    const pastedNames = useRef(new Set<string>())
    const isNameTaken = useCallback(
        (name: string) => {
            const full = currentFolder ? `${currentFolder}/${name}` : name
            return pastedNames.current.has(full) || nodeByPath.has(full)
        },
        [currentFolder, nodeByPath],
    )
    const onPasteFiles = useCallback(
        (files: DroppedFile[]) => {
            for (const f of files)
                pastedNames.current.add(
                    currentFolder ? `${currentFolder}/${f.relativePath}` : f.relativePath,
                )
            uploadIntoFolder(files, currentFolder)
        },
        [uploadIntoFolder, currentFolder],
    )
    useDrivePasteUpload({
        paneRef,
        enabled: chrome && canUpload,
        onFiles: onPasteFiles,
        isNameTaken,
    })
    const writes = useDriveWrites(drive, getPane)
    const siblingsOf = useCallback(
        (folder: string) =>
            (folder === "" ? tree : (nodeByPath.get(folder)?.children ?? [])).map((n) => n.name),
        [tree, nodeByPath],
    )
    // The entry being renamed in place. The folder view that shows it is selected first.
    const [nameEdit, setNameEdit] = useState<{
        path: string
        kind: "folder" | "file"
        /** A folder created a moment ago and still empty: renamed by create + delete. */
        fresh?: boolean
    } | null>(null)
    // New folder / New file: created at once under an untitled name, then named in place.
    const startNew = useCallback(
        async (kind: "folder" | "file", folder: string) => {
            const name = newDriveName(kind, siblingsOf(folder))
            const ok = await (kind === "folder"
                ? writes.createFolder(folder, name)
                : writes.createFile(folder, name))
            if (!ok) return
            if (selectedPath !== folder) select(folder)
            setNameEdit({path: joinPath(folder, name), kind, fresh: kind === "folder"})
        },
        [siblingsOf, writes, selectedPath, select],
    )

    const editableFile = chrome && canWrite && !selectedIsFolder && !!selectedPath
    const selectedKind = resolveDriveFileKind(selectedPath ?? "")
    // Over the caps a file opens read-only.
    const markdownKind = editableFile && PROSE_KINDS.has(selectedKind)
    const codeKind = editableFile && CODE_EDIT_KINDS.has(selectedKind)
    const editableMarkdown = markdownKind && (selectedFileSize ?? 0) <= DRIVE_MARKDOWN_EDIT_CAP
    const editableCode = codeKind && (selectedFileSize ?? 0) <= DRIVE_CODE_EDIT_CAP
    const tooLargeToEdit = (markdownKind || codeKind) && !editableMarkdown && !editableCode
    // An editable HTML file shows its source or the rendered document (row 2 switches).
    const htmlKind = editableCode && selectedKind === "html"
    const agentAppsEnabled = useAtomValue(agentAppsEnabledAtom)
    const [htmlView, setHtmlView] = useState<"source" | "preview" | "run">("source")
    // Run needs the flag and a mount; without them a stale "run" falls back to Preview.
    const htmlRunnable = htmlKind && agentAppsEnabled && !!selectedMount
    const htmlPreview = htmlKind && htmlView !== "source"
    const htmlBodyView = htmlView === "run" && htmlRunnable ? "run" : "preview"
    const editing = editableMarkdown || editableCode
    const editor = useDriveFileEditor(
        editing ? selectedMount : null,
        editing ? selectedMountPath : "",
    )
    // Row 2's slot for the editor's formatting bar.
    const [toolbarEl, setToolbarEl] = useState<HTMLDivElement | null>(null)
    const {save: saveDraft, discard: discardDraft} = editor
    const onSave = useCallback(() => void saveDraft(), [saveDraft])

    // On the open file a rename flushes the draft first; a delete forgets it.
    const commitName = useCallback(
        async (name: string): Promise<boolean> => {
            if (!nameEdit) return false
            const {path, fresh} = nameEdit
            if (editing && path === selectedPath) await saveDraft()
            const ok = await (fresh
                ? writes.renameEmptyFolder(path, name)
                : writes.rename(path, name))
            if (!ok) return false
            if (path === selectedPath) replaceSelection(joinPath(parentOf(path), name))
            setNameEdit(null)
            return true
        },
        [nameEdit, writes, editing, selectedPath, saveDraft, replaceSelection],
    )
    const startRename = useCallback(
        (path: string) => {
            const folder = parentOf(path)
            if (selectedPath !== folder) select(folder)
            setNameEdit({path, kind: nodeByPath.get(path)?.isFolder ? "folder" : "file"})
        },
        [selectedPath, select, nodeByPath],
    )
    const nameEditView = useMemo<DriveNameEdit | null>(() => {
        if (!nameEdit) return null
        const siblings = siblingsOf(parentOf(nameEdit.path))
        const current = nameOf(nameEdit.path)
        return {
            path: nameEdit.path,
            kind: nameEdit.kind,
            initial: current,
            validate: (name) => validateDriveName(name, siblings, current),
            onCommit: commitName,
            onCancel: () => setNameEdit(null),
        }
    }, [nameEdit, siblingsOf, commitName])
    const onDelete = useCallback(
        async (path: string, isFolder: boolean) => {
            if (!writes.canDelete(path)) return
            const node = nodeByPath.get(path)
            const under =
                selectedPath != null &&
                (selectedPath === path || selectedPath.startsWith(`${path}/`))
            if (under && editing) discardDraft()
            const ok = await writes.remove(path, isFolder, node?.itemCount ?? node?.children.length)
            if (!ok) return
            // The selection is gone: land on the parent folder.
            if (under) select(parentOf(path))
        },
        [writes, nodeByPath, selectedPath, editing, discardDraft, select],
    )
    const itemWrites = useMemo<DriveItemWriteActions | undefined>(
        () =>
            canWrite
                ? {
                      onRename: startRename,
                      onDelete: (path, isFolder) => void onDelete(path, isFolder),
                  }
                : undefined,
        [canWrite, startRename, onDelete],
    )
    const fileActions = useMemo<DriveFileActions | undefined>(
        () =>
            canWrite && selectedPath && !selectedIsFolder
                ? {
                      onRename: () => startRename(selectedPath),
                      renameTo: async (name) => {
                          if (editing) await saveDraft()
                          const ok = await writes.rename(selectedPath, name)
                          if (ok) replaceSelection(joinPath(parentOf(selectedPath), name))
                          return ok
                      },
                      validateName: (name) =>
                          validateDriveName(
                              name,
                              siblingsOf(parentOf(selectedPath)),
                              nameOf(selectedPath),
                          ),
                      onDelete: () => void onDelete(selectedPath, false),
                  }
                : undefined,
        [
            canWrite,
            selectedPath,
            selectedIsFolder,
            startRename,
            onDelete,
            writes,
            editing,
            saveDraft,
            replaceSelection,
            siblingsOf,
        ],
    )

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

    // The pane-wide chords: history, up a level, and Esc off an open file (see driveNavKeys).
    const onNavKeyDown = useCallback(
        (e: KeyboardEvent<HTMLDivElement>) => {
            if (e.defaultPrevented) return
            const action = driveNavAction({...e, editable: isEditableTarget(e.target)})
            if (!action) return
            if (action === "back" && !canGoBack) return
            if (action === "forward" && !canGoForward) return
            if ((action === "up" || action === "close") && !selectedPath) return
            if (action === "close" && selectedIsFolder) return
            e.preventDefault()
            if (action === "back") goBack()
            else if (action === "forward") goForward()
            else select(parentOf(selectedPath ?? ""))
        },
        [canGoBack, canGoForward, selectedPath, selectedIsFolder, goBack, goForward, select],
    )

    // Row 2's read-side actions: copy path (none at the root), download (file, folder zip, or all).
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
        // The folder's verbs — row 2's ⋯ and the blank-space right-click menu share them.
        const folderMenu: DriveFolderMenuProps | undefined =
            chrome && selectedIsFolder
                ? {
                      actions: canWrite
                          ? {
                                onNewFolder: () => void startNew("folder", selectedPath ?? ""),
                                onNewFile: () => void startNew("file", selectedPath ?? ""),
                                onUpload: staged.length ? commitStaged : openUploadPicker,
                                stagedCount: staged.length,
                            }
                          : undefined,
                      onCopyPath: onCopyCurrentPath,
                      onDownloadAll: onDownloadCurrent,
                      downloadingAll,
                  }
                : undefined

        // Row 2 follows the selection.
        const contentHeader = !chrome ? null : selectedIsFolder ? (
            <DriveToolbar
                variant="folder"
                view={view}
                setView={setView}
                sort={sort}
                setSort={setSort}
                {...folderMenu}
            />
        ) : editableMarkdown ? (
            <DriveToolbar
                variant="markdown"
                path={selectedPath ?? ""}
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
                              onChange: (v) => setHtmlView(v as "source" | "preview" | "run"),
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
                                  ...(htmlRunnable
                                      ? [
                                            {
                                                value: "run",
                                                label: "Run",
                                                icon: <Play className="size-3.5" />,
                                            },
                                        ]
                                      : []),
                              ],
                          }
                        : undefined
                }
                onCopyPath={onCopyCurrentPath}
                onDownload={onDownloadCurrent}
            />
        )

        // The content column: the folder's children, an editor, or a preview.
        const contentPane =
            selectedPath == null ? (
                <div className="flex h-full flex-1 items-center justify-center text-xs text-colorTextTertiary">
                    Select a file to preview it.
                </div>
            ) : selectedIsFolder ? (
                <FolderView
                    folderPath={selectedPath}
                    // A search narrows the content too.
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
                    folderMenu={folderMenu}
                    editing={nameEditView}
                    loading={
                        selectedPath !== "" &&
                        !searchActive &&
                        !lazyTree.loadedDirs.has(selectedPath)
                    }
                    // In chrome mode rows 1 + 2 own the breadcrumb and actions.
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
                    key={`${selectedMount?.id ?? ""}/${selectedMountPath}`}
                    mount={selectedMount}
                    path={selectedMountPath}
                    mode={editorMode}
                    toolbarContainer={toolbarEl}
                    loading={editor.loading}
                    failed={editor.failed}
                    onSave={onSave}
                    displayPath={selectedPath}
                    onNavigate={select}
                    linkExists={linkExists}
                />
            ) : htmlPreview ? (
                <DriveHtmlApp
                    mount={selectedMount}
                    path={selectedMountPath}
                    displayPath={selectedPath}
                    onNavigate={select}
                    view={htmlBodyView}
                    onViewChange={setHtmlView}
                    linkExists={linkExists}
                />
            ) : editableCode ? (
                <DriveCodeEditor
                    mount={selectedMount}
                    path={selectedMountPath}
                    displayPath={selectedPath}
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
                    linkExists={linkExists}
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
                            onValueChange={setSearch}
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
                <div ref={paneRef} className="relative flex h-full min-h-0 w-full flex-col">
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
                    <div className="flex min-h-0 flex-1 flex-col" onKeyDown={onNavKeyDown}>
                        {body}
                    </div>
                </div>
            ) : (
                body
            )}
        </>
    )
}
