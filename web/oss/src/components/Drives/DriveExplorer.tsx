/**
 * DriveExplorer — the heavy browsing body of the drive surfaces: search + file tree + breadcrumb +
 * metadata + Download + the kind-matched content viewer. Split into its OWN module so the drawer
 * shells can `next/dynamic`-import it: the tree/renderer/pdfjs/markdown graph then loads only when a
 * drawer actually opens, never with the always-mounted config panel or chat pane.
 *
 * The ONE drawer's body (via {@link FilesDrawer}) for BOTH hosts — the config panel and the chat pane
 * (chrome mode: renders its own single header). Also embeddable headerless. Phase 1 is read-only.
 *
 * This module is the COMPOSITION ROOT: every concern below it lives in a sibling hook — selection +
 * persistence ({@link useDriveSelection}), filters ({@link useDriveFilters}), uploads + the staged
 * inbox ({@link useDriveUploads}), the lazy tree pipeline ({@link useDriveTreeData}), the pane
 * geometry ({@link useDriveTreePane}), the scroll viewport + virtualizer
 * ({@link useDriveTreeViewport}), the per-group horizontal scroll ({@link useTreeGroupScroll}),
 * keyboard nav ({@link useDriveTreeKeyboard}), selection reveal ({@link useDriveTreeReveal}) and
 * "Download all" ({@link useDriveDownloadAll}).
 */
import {type ReactNode, useCallback, useRef, useState} from "react"

import {type MountFile} from "@agenta/entities/session"
import {useAtomValue} from "jotai"

import {projectIdAtom} from "@/oss/state/project"

import {driveRootLabel} from "./DriveBreadcrumb"
import {DriveExplorerSkeleton} from "./DriveExplorerSkeleton"
import {DriveEmptyState, DriveErrorState} from "./DriveExplorerStates"
import {DriveFilePreview} from "./DriveFilePreview"
import {DriveHeader} from "./DriveHeader"
import {useCopyDrivePath, useCopyText, useDriveItemDownload} from "./DriveItemContextMenu"
import {useRepoInfo} from "./driveRepo"
import {DriveToolbar} from "./DriveToolbar"
import {DriveTreeList} from "./DriveTreeList"
import {DriveTreePane} from "./DriveTreePane"
import {looksLikeFilePath} from "./driveTreeView"
import {type DriveId, type DriveScope} from "./driveTypes"
import {type DroppedFile} from "./dropEntries"
import {FolderView} from "./FolderView"
import {useDriveDownloadAll} from "./useDriveDownloadAll"
import {useDriveFilters} from "./useDriveFilters"
import {useDriveSelection} from "./useDriveSelection"
import {useDriveTreeData} from "./useDriveTreeData"
import {useDriveTreeKeyboard} from "./useDriveTreeKeyboard"
import {useDriveTreePane} from "./useDriveTreePane"
import {useDriveTreeReveal} from "./useDriveTreeReveal"
import {useDriveTreeViewport} from "./useDriveTreeViewport"
import {useDriveUploads} from "./useDriveUploads"
import {driveHasMixedOrigins, type SessionDriveData} from "./useSessionDrive"
import {useTreeGroupScroll} from "./useTreeGroupScroll"
import {useUploadReveal} from "./useUploadReveal"

export type {DriveId, DriveScope} from "./driveTypes"

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
    onClose,
    driveIds,
    expanded: drawerExpanded = false,
    onToggleExpand,
    stagedFiles,
    onStagedChange,
}: {
    drive: SessionDriveData
    /** Render this flat list instead of the mount's lazy-loaded tree — the local-file mode used to
     * preview composer attachments. When set, the mount tree and its loading states are bypassed;
     * bytes come from a `DriveFileSourceContext` (see `driveFileSource`) rather than downloads. */
    explicitFiles?: MountFile[]
    scope?: DriveScope
    initialPath?: string | null
    /** When provided, the explorer renders its OWN single header (breadcrumb + node + actions + this
     * close button) + the shared search/filters toolbar. Always provided by {@link FilesDrawer}. */
    onClose?: () => void
    /** Raw ids for the header's overflow menu (drive id + session/agent id). */
    driveIds?: DriveId[]
    /** The host drawer is at expanded (near-full) width — reflected by the header's expand toggle. */
    expanded?: boolean
    onToggleExpand?: () => void
    /** Files dropped on a recents peek, staged (unwritten) until the user picks a destination folder
     * and clicks "Upload here" — shown as ghost tiles in the grid. The host owns the list. */
    stagedFiles?: DroppedFile[]
    onStagedChange?: (files: DroppedFile[]) => void
}) {
    const rootLabel = driveRootLabel(drive.mount)
    const {
        search,
        setSearch,
        originFilter,
        setOriginFilter,
        showHidden,
        setShowHidden,
        showGitignored,
        setShowGitignored,
        deferredSearch,
        searchActive,
    } = useDriveFilters()
    const {persistedSelection, selectedPath, select, expanded, setExpanded} = useDriveSelection({
        mountId: drive.mount?.id ?? "",
        initialPath,
    })

    const copyPath = useCopyDrivePath()
    const download = useDriveItemDownload(drive)
    const copyText = useCopyText()
    const projectId = useAtomValue(projectIdAtom)
    // Chrome mode renders the single header + toolbar (the drawer hosts always pass onClose).
    const chrome = onClose != null
    // Details toggle, lifted so the ONE header owns it (file meta OR repo facts, per selection).
    const [detailsOpen, setDetailsOpen] = useState(false)
    const pane = useDriveTreePane({searchActive})
    const {showTree, toggleTree, treeVisible, treeShift} = pane
    const {archiveMounts, downloadingAll, handleDownloadAll} = useDriveDownloadAll({
        drive,
        projectId,
    })

    // Uploads sit ABOVE the tree, but a finished upload is only explainable AGAINST the tree (is the
    // file in the listing, or did a filter swallow it?) — so the completion callback forwards through
    // a ref that useUploadReveal fills in once both halves exist.
    const revealUpload = useRef<(path: string) => void>(() => undefined)
    const onUploaded = useCallback((path: string) => revealUpload.current(path), [])
    // Uploads sit ABOVE the tree: their in-flight files are folded into the build below, so each one
    // renders as a real row/tile under its destination folder.
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
        inGitScope,
        tree,
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
        originFilter,
        showHidden,
        showGitignored,
    })
    // Closes the loop opened above: a completed upload toasts, and anything the filters would have
    // hidden (a dotfile, a git-ignored `.env`) reveals itself instead of blinking out.
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
    const currentFolder = selectedIsFolder
        ? (selectedPath ?? "")
        : selectedPath
          ? selectedPath.slice(0, Math.max(0, selectedPath.lastIndexOf("/")))
          : ""
    const commitStaged = useCallback(() => {
        if (!staged.length) return
        uploadIntoFolder(staged, currentFolder)
        onStagedChange?.([])
    }, [staged, currentFolder, uploadIntoFolder, onStagedChange])

    const selected = drive.recents.find((f) => f.path === selectedPath) ?? null
    const showOrigin = driveHasMixedOrigins(drive.recents)

    // Repo probe for the header's details toggle (chrome mode) — is the SELECTED folder a git repo?
    // Gated on chrome + folder so it never fires for the embedded explorer or a file selection. The
    // FolderView probes the same (mount, path) for its meta panel; react-query shares the cache.
    const headerResolved = chrome ? drive.resolveMount(selectedPath ?? "") : null
    const headerRepo = useRepoInfo(
        headerResolved?.mount ?? null,
        headerResolved?.path ?? "",
        chrome && selectedIsFolder,
    )
    // A file's size for the header chip (recents first, else the tree node).
    const selectedFileSize = selected?.size ?? selectedNode?.size ?? undefined
    // A non-root folder's immediate-child count (loaded children, else the backend count).
    const selectedItemCount =
        selectedIsFolder && selectedPath
            ? (selectedNode?.itemCount ?? selectedNode?.children.length ?? null)
            : null

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

    // Only a TOTAL failure blanks the drawer. A partial failure — the artifact-scoped agent mount
    // erroring while the session's own files loaded (or vice-versa) — still has a tree to browse, so
    // it falls through and renders the tree; its retry rides the existing header (see DriveHeader's
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
            />
        )
    } else if (drive.fileCount === 0) {
        body = <DriveEmptyState scope={scope} />
    } else {
        // What shows for the current selection: the folder's children (as a tile grid) or a file's
        // preview. The right pane of the tree navigator (and the whole body when the tree is hidden).
        const contentPane =
            selectedPath == null ? (
                <div className="flex h-full flex-1 items-center justify-center text-xs text-colorTextTertiary">
                    Select a file to preview it.
                </div>
            ) : selectedIsFolder ? (
                <FolderView
                    folderPath={selectedPath}
                    nodes={selectedPath === "" ? tree : (selectedNode?.children ?? [])}
                    rootLabel={rootLabel}
                    drive={drive}
                    showOrigin={showOrigin}
                    loading={
                        selectedPath !== "" &&
                        !searchActive &&
                        !lazyTree.loadedDirs.has(selectedPath)
                    }
                    // Chrome mode: the single header owns the breadcrumb/name/repo toggle, so the pane
                    // drops its header and just shows the meta (when open) + grid.
                    hideHeader={chrome}
                    detailsOpen={detailsOpen}
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
            ) : (
                <DriveFilePreview
                    // Preview reads from the file's own mount (cwd or the nested agent-files mount),
                    // but the breadcrumb/name show the presented path (agent-files/ prefix).
                    mount={drive.resolveMount(selectedPath)?.mount ?? drive.mount}
                    path={drive.resolveMount(selectedPath)?.path ?? selectedPath}
                    displayPath={selectedPath}
                    showOrigin={showOrigin}
                    rootLabel={rootLabel}
                    touchedAt={selected?.touchedAt}
                    size={selected?.size ?? undefined}
                    hideHeader={chrome}
                    detailsOpen={detailsOpen}
                    onSelect={select}
                />
            )
        body = (
            <DriveTreePane
                pane={pane}
                treeScrollRef={treeScrollRef}
                onTreeKeyDown={onTreeKeyDown}
                treeDropProps={canUpload ? drop.containerDropProps(currentFolder) : undefined}
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
            {onClose ? (
                <div className="flex h-full min-h-0 w-full flex-col">
                    <DriveHeader
                        selectedPath={selectedPath}
                        isFolder={selectedIsFolder}
                        rootLabel={rootLabel}
                        itemCount={selectedItemCount}
                        totalCount={drive.fileCount}
                        totalCapped={drive.fileCountCapped}
                        fileSize={selectedFileSize}
                        showOrigin={showOrigin}
                        isRepo={headerRepo.isRepo}
                        detailsOpen={detailsOpen}
                        onToggleDetails={() => setDetailsOpen((v) => !v)}
                        onNavigate={select}
                        onClose={onClose}
                        copyText={copyText}
                        ids={driveIds ?? []}
                        downloadMount={
                            selectedPath ? (drive.resolveMount(selectedPath)?.mount ?? null) : null
                        }
                        downloadPath={
                            selectedPath
                                ? (drive.resolveMount(selectedPath)?.path ?? selectedPath)
                                : ""
                        }
                        onDownloadAll={archiveMounts.length ? handleDownloadAll : undefined}
                        downloadingAll={downloadingAll}
                        expanded={drawerExpanded}
                        onToggleExpand={onToggleExpand}
                        partialErrored={drive.partialErrored}
                        onRetry={drive.retry}
                        retrying={drive.isFetching}
                        onUpload={canUpload ? () => uploadInputRef.current?.click() : undefined}
                        stagedCount={staged.length}
                        onUploadStaged={commitStaged}
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
                    {/* Pending uploads render as tiles in the grid + a pinned group in the tree (both
                        drawer-global), so no separate header banner here — a banner that mounts/unmounts
                        shoved the toolbar + panes on every upload state change. */}
                    <DriveToolbar
                        search={search}
                        setSearch={setSearch}
                        searchActive={searchActive}
                        showTree={showTree}
                        treeVisible={treeVisible}
                        toggleTree={toggleTree}
                        showOrigin={showOrigin}
                        originFilter={originFilter}
                        setOriginFilter={setOriginFilter}
                        showHidden={showHidden}
                        setShowHidden={setShowHidden}
                        inGitScope={inGitScope}
                        showGitignored={showGitignored}
                        setShowGitignored={setShowGitignored}
                    />
                    <div className="flex min-h-0 flex-1 flex-col">{body}</div>
                </div>
            ) : (
                body
            )}
        </>
    )
}
