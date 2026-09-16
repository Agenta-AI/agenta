import {useEffect, useMemo, useRef, useState} from "react"

import {PANE_FADE, revealFade} from "@agenta/entities/drive"
import {useRepoInfo} from "@agenta/entities/drive"
import {type DriveSortKey, type DriveTreeNode, type DriveViewMode} from "@agenta/entities/drive"
import {itemCountLabel, parentOf, sortDriveEntries} from "@agenta/entities/drive"
import {useDelayedTrue} from "@agenta/entities/drive"
import {type DriveDrop} from "@agenta/entities/drive"
import {type MountUploadItem} from "@agenta/entities/drive"
import {type SessionDriveData} from "@agenta/entities/drive"
import {CopyButton} from "@agenta/ui/components/presentational"
import {EnhancedButton as Button} from "@agenta/ui/components/presentational"
import {
    Empty,
    EmptyDescription,
    EmptyHeader,
    EmptyMedia,
    EmptyTitle,
    SimpleTooltip as Tooltip,
} from "@agenta/ui/ui"
import {Folder, FolderSimple, GitBranch} from "@phosphor-icons/react"
import {AnimatePresence, motion} from "motion/react"

import {DriveBreadcrumb} from "./DriveBreadcrumb"
import {TileGridSkeleton} from "./DriveExplorerSkeleton"
import {
    DriveItemContextMenu,
    type DriveItemWriteActions,
    useCopyDrivePath,
    useDriveItemDownload,
} from "./DriveItemContextMenu"
import {type DriveNameEdit, NEW_ENTRY_PATH} from "./DriveNameField"
import {StagedTile, UploadTile, type StagedTileItem} from "./DrivePendingTiles"
import {FolderList} from "./FolderList"
import {DraftTile, FileTile, FolderTile} from "./FolderTile"
import {DriveRepoMetaList} from "./repoMeta"
import {VirtualTileGrid} from "./VirtualTileGrid"

/** Right pane when a FOLDER is selected: fixed header (clickable breadcrumb + folder name) over a
 * grid of the folder's immediate children — subfolders drill in, files open the preview. Reuses the
 * Finder-style tiles (FolderTile / FileTile) or the shared list table. */
export const FolderView = ({
    folderPath,
    nodes,
    rootLabel,
    drive,
    loading,
    hideHeader,
    view = "grid",
    sort = "name",
    selectedPath = null,
    writes,
    editing,
    autoFocus,
    anticipateShift,
    onSelect,
    drop,
    pendingUploadByPath,
    onRetryUpload,
    onDismissUpload,
    stagedItems,
    onRemoveStaged,
}: {
    folderPath: string
    nodes: DriveTreeNode[]
    rootLabel: string
    drive: SessionDriveData
    /** Grid (tiles) or list (the shared table). */
    view?: DriveViewMode
    sort?: DriveSortKey
    /** The explorer's selection — a tile / row that is the current path draws selected. */
    selectedPath?: string | null
    /** Item context-menu writes; omit on a read-only mount. */
    writes?: DriveItemWriteActions
    /** An entry being named in place (see {@link DriveNameEdit}). */
    editing?: DriveNameEdit | null
    /** Drag-and-drop upload behaviour (folder highlight, spring-load, drop) — absent = disabled. */
    drop?: DriveDrop
    /** In-flight uploads keyed by their real tree path — the matching node (injected into the tree) is
     * drawn as a progress/error tile instead of a plain file. */
    pendingUploadByPath?: Map<string, MountUploadItem>
    onRetryUpload?: (id: string) => void
    onDismissUpload?: (id: string) => void
    /** Files staged (dropped on a recents peek) awaiting a destination — ghost tiles shown in EVERY
     * folder until committed with "Upload here", regardless of this folder's path. */
    stagedItems?: StagedTileItem[]
    onRemoveStaged?: (id: string) => void
    /** This folder's level is still loading (lazy) — show the tile skeleton, not "Empty folder". */
    loading?: boolean
    /** Chrome mode: rows 1 + 2 own the breadcrumb and actions, so no header band (nor repo details). */
    hideHeader?: boolean
    /** Focus the first tile on mount (grid is the primary nav — not the list view's right pane). */
    autoFocus?: boolean
    /** Announced pane-width shift (tree pane toggling) — forwarded to the tile grid so it lays out
     * for the final width immediately instead of chasing the mid-animation width. */
    anticipateShift?: {delta: number; seq: number} | null
    onSelect: (path: string) => void
}) => {
    const copyPath = useCopyDrivePath()
    const download = useDriveItemDownload(drive)
    const folderName = folderPath === "" ? rootLabel : (folderPath.split("/").pop() ?? folderPath)
    // Which mount + mount-relative path backs this folder, so the repo probe reads its `.git`.
    const resolvedFolder = drive.resolveMount(folderPath)
    // Git facts, probed only where the header band that shows them renders.
    const repo = useRepoInfo(resolvedFolder?.mount ?? null, resolvedFolder?.path ?? "", !hideHeader)
    const [repoExpanded, setRepoExpanded] = useState(false)
    // One combined list, folders first, so the grid windows uniformly.
    const sorted = useMemo(() => {
        const list = sortDriveEntries(nodes, sort)
        // A new entry sits first while it is being named.
        return editing?.path === null
            ? [
                  {
                      name: editing.initial,
                      path: NEW_ENTRY_PATH,
                      isFolder: editing.kind === "folder",
                      children: [],
                  },
                  ...list,
              ]
            : list
    }, [nodes, sort, editing])
    // Staged drops are ghost tiles in the grid only (the list shows real rows; row 2's ⋯ uploads them).
    const stagedByPath = useMemo(
        () =>
            new Map<string, StagedTileItem>(
                (stagedItems ?? []).map((it) => [`__staged__/${it.id}`, it]),
            ),
        [stagedItems],
    )
    const entries = useMemo(() => {
        const synthetic: DriveTreeNode[] = (stagedItems ?? []).map((it) => ({
            name: it.name,
            path: `__staged__/${it.id}`,
            isFolder: false,
            children: [],
        }))
        return [...synthetic, ...sorted]
    }, [stagedItems, sorted])
    // Only surface the skeleton if the level is genuinely slow to load (>140ms); a quick load skips
    // straight to the grid so the user never sees a one-frame skeleton flash.
    const showSkeleton = useDelayedTrue(Boolean(loading) && nodes.length === 0, 140)

    // One-shot stagger gate for the tile grid — true ONLY on the render where this folder+view's content
    // first appears (folder nav or skeleton→grid), so the tiles cascade in; empty on every render after,
    // so the virtualizer's scroll remounts never replay it (mirrors the tree's reveal). StrictMode-safe:
    // the ref advances in an effect, not during render, so the diff doesn't cancel itself out.
    const shown = view === "list" ? sorted : entries
    const gridRevealKey = shown.length > 0 ? `${folderPath}:${view}` : null
    const prevGridRevealRef = useRef<string | null>(null)
    const gridRevealNow = gridRevealKey !== null && gridRevealKey !== prevGridRevealRef.current
    useEffect(() => {
        prevGridRevealRef.current = gridRevealKey
    }, [gridRevealKey])

    return (
        <div className="flex h-full min-h-0 w-full flex-col">
            {hideHeader ? null : (
                <div className="flex shrink-0 flex-col gap-2 border-0 border-b border-solid border-colorBorderSecondary p-4 pb-3">
                    <DriveBreadcrumb
                        shown={folderPath}
                        rootLabel={rootLabel}
                        onNavigate={onSelect}
                    />
                    <div className="flex items-center justify-between gap-2">
                        <div className="flex min-w-0 items-center gap-2">
                            <FolderSimple
                                size={16}
                                weight="fill"
                                className="shrink-0 text-colorWarning"
                            />
                            <span className="truncate font-mono text-[13px] font-semibold">
                                {folderName}
                            </span>
                            <span className="shrink-0 text-xs text-colorTextTertiary">
                                {itemCountLabel(nodes.length)}
                            </span>
                        </div>
                        {/* Action cluster — Copy path mirrors the file preview header; repo-details
                            toggle joins it when this folder is a git repo. Root ("") has no path. */}
                        <div className="flex shrink-0 items-center gap-1">
                            {folderPath ? (
                                <Tooltip title="Copy path">
                                    <CopyButton
                                        text={folderPath}
                                        buttonText={null}
                                        icon
                                        size="icon-sm"
                                        aria-label="Copy folder path"
                                        successMessage=""
                                        className="!h-7 !w-7 !p-0 !text-colorTextTertiary hover:!text-colorText"
                                    />
                                </Tooltip>
                            ) : null}
                            {repo.isRepo ? (
                                <Tooltip title="Repository details">
                                    <Button
                                        type="text"
                                        aria-label="Repository details"
                                        aria-pressed={repoExpanded}
                                        onClick={() => setRepoExpanded((v) => !v)}
                                        icon={
                                            <GitBranch
                                                size={16}
                                                weight={repoExpanded ? "fill" : "regular"}
                                            />
                                        }
                                        className={`!h-7 !w-7 !p-0 ${
                                            repoExpanded
                                                ? "!text-colorPrimary"
                                                : "!text-colorTextTertiary hover:!text-colorText"
                                        }`}
                                    />
                                </Tooltip>
                            ) : null}
                        </div>
                    </div>
                    <DriveRepoMetaList info={repo} expanded={repoExpanded} />
                </div>
            )}

            {/* The content region crossfades between its states (absolute + overlapping), so a folder
                swap or skeleton→grid never hard-cuts. The skeleton is DELAYED — a fast load skips it
                entirely and the grid fades straight in from the previous folder. */}
            <div
                className={`relative min-h-0 flex-1 transition-colors ${
                    drop?.hoverPath === folderPath ? "bg-[var(--ant-color-primary-bg)]" : ""
                }`}
                {...(drop ? drop.containerDropProps(folderPath) : {})}
            >
                <AnimatePresence initial={false}>
                    {shown.length > 0 ? (
                        <motion.div
                            key={`grid:${folderPath}`}
                            className="absolute inset-0 flex min-h-0 flex-col"
                            // No container fade-in — the tiles carry the entrance (staggered below), so
                            // the reveal doesn't double up opacity. Still fades OUT on leave, so
                            // folder→folder and grid→skeleton stay crossfaded.
                            initial={false}
                            animate={{opacity: 1}}
                            exit={{opacity: 0}}
                            transition={PANE_FADE.transition}
                        >
                            {view === "list" ? (
                                <FolderList
                                    nodes={sorted}
                                    editing={editing}
                                    selectedPath={selectedPath}
                                    onOpen={onSelect}
                                    onCopyPath={copyPath}
                                    onDownload={download}
                                    writes={writes}
                                />
                            ) : (
                                <VirtualTileGrid
                                    items={entries}
                                    autoFocus={autoFocus}
                                    autoFocusKey={folderPath}
                                    anticipateShift={anticipateShift}
                                    // Responsive tiles, windowed so a folder with thousands of children
                                    // stays smooth.
                                    minColumnWidth={132}
                                    estimateRowHeight={124}
                                    thumbAspect={0}
                                    gap={4}
                                    className="px-5 pb-6 pt-4"
                                    // Arrow keys rove the tiles (handled in VirtualTileGrid); Cmd/Ctrl+↓
                                    // opens the focused item (folder → drill in, file → preview), Cmd/Ctrl+↑
                                    // steps OUT to the current folder's parent (Finder-style).
                                    onMetaActivate={(n) => onSelect(n.path)}
                                    onMetaBack={() => onSelect(parentOf(folderPath))}
                                    getKey={(n) => n.path}
                                    renderTile={(n) => {
                                        // Staged ghost tile (synthetic node) — awaiting a destination, no
                                        // progress yet. Fades itself in like the upload tile.
                                        const stagedItem = stagedByPath.get(n.path)
                                        if (stagedItem) {
                                            return (
                                                <motion.div
                                                    className="min-w-0"
                                                    initial={{opacity: 0, scale: 0.96}}
                                                    animate={{opacity: 1, scale: 1}}
                                                    transition={{
                                                        duration: 0.18,
                                                        ease: [0.4, 0, 0.2, 1],
                                                    }}
                                                >
                                                    <StagedTile
                                                        item={stagedItem}
                                                        onRemove={onRemoveStaged}
                                                    />
                                                </motion.div>
                                            )
                                        }
                                        // In-flight upload: this is a REAL node (injected into the tree),
                                        // drawn as a progress/error tile instead of a plain file.
                                        const uploadItem = pendingUploadByPath?.get(n.path)
                                        if (uploadItem) {
                                            return (
                                                <motion.div
                                                    className="min-w-0"
                                                    // A new upload appears mid-listing, so it always fades
                                                    // itself in (the grid glides the others aside) — not
                                                    // gated on the folder's one-shot reveal.
                                                    initial={{opacity: 0, scale: 0.96}}
                                                    animate={{opacity: 1, scale: 1}}
                                                    transition={{
                                                        duration: 0.18,
                                                        ease: [0.4, 0, 0.2, 1],
                                                    }}
                                                >
                                                    <UploadTile
                                                        item={uploadItem}
                                                        onRetry={onRetryUpload}
                                                        onDismiss={onDismissUpload}
                                                    />
                                                </motion.div>
                                            )
                                        }
                                        if (
                                            editing &&
                                            (n.path === editing.path || n.path === NEW_ENTRY_PATH)
                                        )
                                            return (
                                                <DraftTile
                                                    edit={editing}
                                                    path={editing.path ?? editing.initial}
                                                />
                                            )
                                        const open = () => onSelect(n.path)
                                        const content = (
                                            <DriveItemContextMenu
                                                path={n.path}
                                                isFolder={n.isFolder}
                                                onOpen={open}
                                                onCopyPath={copyPath}
                                                onDownload={download}
                                                writes={writes}
                                            >
                                                {n.isFolder ? (
                                                    <FolderTile
                                                        node={n}
                                                        selected={n.path === selectedPath}
                                                        onOpen={open}
                                                    />
                                                ) : (
                                                    <FileTile
                                                        node={n}
                                                        selected={n.path === selectedPath}
                                                        onOpen={open}
                                                    />
                                                )}
                                            </DriveItemContextMenu>
                                        )
                                        // One-shot staggered entrance (see gridRevealNow) — cascades the
                                        // tiles in by index when the level first reveals; `min-w-0` keeps
                                        // the wrapper a shrinkable grid cell so tiles don't overflow.
                                        // Folder tiles are drop targets: spring-load + upload, with a
                                        // ring while hovered.
                                        const folderDrop =
                                            n.isFolder && drop
                                                ? drop.folderDropProps(n.path)
                                                : undefined
                                        return (
                                            <motion.div
                                                className={`min-w-0 rounded-lg ${
                                                    drop?.hoverPath === n.path
                                                        ? "ring-2 ring-colorPrimary"
                                                        : ""
                                                }`}
                                                {...folderDrop}
                                                {...revealFade(gridRevealNow)}
                                            >
                                                {content}
                                            </motion.div>
                                        )
                                    }}
                                />
                            )}
                        </motion.div>
                    ) : showSkeleton ? (
                        <motion.div
                            key="skel"
                            className="absolute inset-0 flex min-h-0 flex-col"
                            {...PANE_FADE}
                        >
                            <TileGridSkeleton className="p-4" />
                        </motion.div>
                    ) : loading ? null : (
                        <motion.div
                            key="empty"
                            className="absolute inset-0 flex flex-col items-center justify-center"
                            {...PANE_FADE}
                        >
                            <Empty className="gap-1.5 p-8">
                                <EmptyHeader className="gap-1">
                                    <EmptyMedia variant="icon">
                                        <Folder size={28} />
                                    </EmptyMedia>
                                    <EmptyTitle className="text-[13px]">Nothing here</EmptyTitle>
                                    <EmptyDescription className="text-xs">
                                        Drop files to upload, or use Upload.
                                    </EmptyDescription>
                                </EmptyHeader>
                            </Empty>
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>
        </div>
    )
}
