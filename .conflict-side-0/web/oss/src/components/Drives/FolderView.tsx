import {useEffect, useMemo, useRef, useState} from "react"

import {CopyButton} from "@agenta/ui/components/presentational"
import {FolderSimple, GitBranch, Tray} from "@phosphor-icons/react"
import {Button, Tooltip} from "antd"
import {AnimatePresence, motion} from "motion/react"

import {DriveBreadcrumb} from "./DriveBreadcrumb"
import {TileGridSkeleton} from "./DriveExplorerSkeleton"
import {DriveFileRow} from "./DriveFileRow"
import {DriveItemContextMenu, useCopyDrivePath, useDriveItemDownload} from "./DriveItemContextMenu"
import {META_REVEAL, PANE_FADE, revealFade} from "./driveMotion"
import {StagedTile, UploadTile, type StagedTileItem} from "./DrivePendingTiles"
import {useRepoInfo} from "./driveRepo"
import {humanSize, type DriveTreeNode} from "./driveTree"
import {parentOf} from "./driveTreeView"
import {FolderTile} from "./FolderTile"
import {isRecentlyChanged, useRecentChangeClock} from "./recentChange"
import {DriveRepoMetaList} from "./repoMeta"
import {useDelayedTrue} from "./useDelayedTrue"
import {type DriveDrop} from "./useDriveDrop"
import {type MountUploadItem} from "./useMountUpload"
import {type SessionDriveData} from "./useSessionDrive"
import {VirtualTileGrid} from "./VirtualTileGrid"

/** Right pane when a FOLDER is selected: fixed header (clickable breadcrumb + folder name) over a
 * grid of the folder's immediate children — subfolders drill in, files open the preview. Reuses the
 * chat grid's file tile (DriveFileRow). */
export const FolderView = ({
    folderPath,
    nodes,
    rootLabel,
    drive,
    showOrigin,
    loading,
    hideHeader,
    detailsOpen,
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
    showOrigin: boolean
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
    /** Chrome mode: the drawer's single header owns the breadcrumb/name/repo toggle, so drop this
     * pane's header band — render only the repo meta (when `detailsOpen`) above the grid. */
    hideHeader?: boolean
    detailsOpen?: boolean
    /** Focus the first tile on mount (grid is the primary nav — not the list view's right pane). */
    autoFocus?: boolean
    /** Announced pane-width shift (tree pane toggling) — forwarded to the tile grid so it lays out
     * for the final width immediately instead of chasing the mid-animation width. */
    anticipateShift?: {delta: number; seq: number} | null
    onSelect: (path: string) => void
}) => {
    const now = useRecentChangeClock(drive.lastTouchedAt)
    const copyPath = useCopyDrivePath()
    const download = useDriveItemDownload(drive)
    const recentsByPath = useMemo(
        () => new Map(drive.recents.map((f) => [f.path, f])),
        [drive.recents],
    )
    const folderName = folderPath === "" ? rootLabel : (folderPath.split("/").pop() ?? folderPath)
    // Which mount + mount-relative path backs this folder, so the repo probe reads its `.git`.
    const resolvedFolder = drive.resolveMount(folderPath)
    // Git facts, probed on demand (self-null for a non-repo folder). Its details render like the
    // file preview's metadata — a bare grid behind a header toggle, NOT an always-on card.
    const repo = useRepoInfo(resolvedFolder?.mount ?? null, resolvedFolder?.path ?? "", true)
    const [repoExpanded, setRepoExpanded] = useState(false)
    // Folders first (matching the tree's sort), then files — one combined list so the grid windows
    // uniformly even when a folder holds thousands of immediate children.
    // Staged files (no destination yet) get synthetic `__staged__/` ghost tiles prepended; in-flight
    // uploads are already REAL nodes in `nodes` (injected into the tree under their folder) and are
    // decorated in renderTile via pendingUploadByPath.
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
        return [...synthetic, ...nodes].sort((a, b) =>
            a.isFolder === b.isFolder ? 0 : a.isFolder ? -1 : 1,
        )
    }, [stagedItems, nodes])
    // Only surface the skeleton if the level is genuinely slow to load (>140ms); a quick load skips
    // straight to the grid so the user never sees a one-frame skeleton flash.
    const showSkeleton = useDelayedTrue(Boolean(loading) && nodes.length === 0, 140)

    // Which meta-open state drives the repo panel: the drawer's single header (chrome) or this pane's
    // own toggle (embedded). One expression so the panel reads the same in both modes.
    const repoOpen = hideHeader ? Boolean(detailsOpen) : repoExpanded

    // One-shot stagger gate for the tile grid — true ONLY on the render where this folder+view's content
    // first appears (folder nav or skeleton→grid), so the tiles cascade in; empty on every render after,
    // so the virtualizer's scroll remounts never replay it (mirrors the tree's reveal). StrictMode-safe:
    // the ref advances in an effect, not during render, so the diff doesn't cancel itself out.
    const gridRevealKey = entries.length > 0 ? `${folderPath}:grid` : null
    const prevGridRevealRef = useRef<string | null>(null)
    const gridRevealNow = gridRevealKey !== null && gridRevealKey !== prevGridRevealRef.current
    useEffect(() => {
        prevGridRevealRef.current = gridRevealKey
    }, [gridRevealKey])

    return (
        <div className="flex h-full min-h-0 w-full flex-col">
            {hideHeader ? (
                // Chrome mode: no header band — just the repo meta when the header's toggle is on.
                // AnimatePresence owns the mount/unmount so the bordered band collapses on close.
                <AnimatePresence initial={false}>
                    {repo.isRepo && repoOpen ? (
                        <motion.div
                            key="repo-meta"
                            {...META_REVEAL}
                            className="shrink-0 overflow-hidden"
                        >
                            <div className="border-0 border-b border-solid border-colorBorderSecondary px-4 py-3">
                                <DriveRepoMetaList info={repo} expanded />
                            </div>
                        </motion.div>
                    ) : null}
                </AnimatePresence>
            ) : (
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
                            <span className="shrink-0 text-[11px] text-colorTextTertiary">
                                {nodes.length} item{nodes.length === 1 ? "" : "s"}
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
                                        size="small"
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
                    {entries.length > 0 ? (
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
                            <VirtualTileGrid
                                items={entries}
                                autoFocus={autoFocus}
                                autoFocusKey={folderPath}
                                anticipateShift={anticipateShift}
                                // Responsive tiles, windowed so a folder with thousands of children
                                // stays smooth.
                                minColumnWidth={200}
                                estimateRowHeight={180}
                                gap={8}
                                className="p-4"
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
                                    const open = () => onSelect(n.path)
                                    const file = recentsByPath.get(n.path)
                                    const resolved = drive.resolveMount(n.path)
                                    const content = n.isFolder ? (
                                        <DriveItemContextMenu
                                            path={n.path}
                                            isFolder
                                            onOpen={open}
                                            onCopyPath={copyPath}
                                            onDownload={download}
                                        >
                                            <FolderTile node={n} onOpen={open} />
                                        </DriveItemContextMenu>
                                    ) : (
                                        <DriveItemContextMenu
                                            path={n.path}
                                            isFolder={false}
                                            onOpen={open}
                                            onCopyPath={copyPath}
                                            onDownload={download}
                                        >
                                            <DriveFileRow
                                                variant="tile"
                                                path={n.path}
                                                file={
                                                    resolved && file
                                                        ? {...file, path: resolved.path}
                                                        : file
                                                }
                                                mount={resolved?.mount ?? drive.mount}
                                                showOrigin={showOrigin}
                                                hideFolder
                                                trailing={humanSize(n.size)}
                                                recent={
                                                    file
                                                        ? isRecentlyChanged(file.touchedAt, now)
                                                        : false
                                                }
                                                onOpen={open}
                                            />
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
                            className="absolute inset-0 flex flex-col items-center justify-center gap-1 p-8 text-center"
                            {...PANE_FADE}
                        >
                            <Tray size={26} className="text-colorTextQuaternary" />
                            <div className="text-xs font-medium">Empty folder</div>
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>
        </div>
    )
}
