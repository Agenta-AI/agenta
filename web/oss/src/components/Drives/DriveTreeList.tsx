/**
 * DriveTreeList — the tree pane's virtualized row window: the empty/searching line, the absolutely
 * positioned visible rows, each row's one-shot entrance, its drop target and its context menu.
 * Purely presentational; every value it renders is owned by DriveExplorer's hooks (rows, virtualizer,
 * group scroll, uploads).
 */
import {type Dispatch, type SetStateAction} from "react"

import {Typography} from "antd"
import {motion} from "motion/react"

import {DriveItemContextMenu} from "./DriveItemContextMenu"
import {revealFade} from "./driveMotion"
import {TreeLoadingRow, TreeRow} from "./DriveTreeRow"
import {parentOf, type FlatTreeRow} from "./driveTreeView"
import {type DriveDrop} from "./useDriveDrop"
import {type DriveTreeViewport} from "./useDriveTreeViewport"
import {type MountUploadItem} from "./useMountUpload"

const {Text} = Typography

export function DriveTreeList({
    flatRows,
    searchLoading,
    treeVirtualizer,
    measureRow,
    justLoadedDirs,
    firstEverPaths,
    shownExpanded,
    selectedPath,
    showOrigin,
    isDirLoading,
    scrollXFor,
    onMeasureContent,
    canUpload,
    drop,
    pendingUploadByPath,
    onRetryUpload,
    onDismissUpload,
    setExpanded,
    select,
    copyPath,
    download,
}: {
    flatRows: FlatTreeRow[]
    /** The on-demand full-tree fetch (search) is in flight — the empty line says so. */
    searchLoading: boolean
    treeVirtualizer: DriveTreeViewport["treeVirtualizer"]
    measureRow: DriveTreeViewport["measureRow"]
    justLoadedDirs: ReadonlySet<string>
    /** Paths never shown before — a file landing in an ALREADY-loaded folder still fades in. */
    firstEverPaths: ReadonlySet<string>
    shownExpanded: Set<string>
    selectedPath: string | null
    showOrigin: boolean
    isDirLoading: (path: string) => boolean
    scrollXFor: (parent: string) => number
    onMeasureContent: (parent: string, width: number) => void
    /** Uploads are possible here — only then are folder rows wired as drop targets. */
    canUpload: boolean
    drop: DriveDrop
    /** In-flight uploads keyed by their real tree path — the matching row shows live status. */
    pendingUploadByPath: Map<string, MountUploadItem>
    onRetryUpload?: (id: string) => void
    onDismissUpload?: (id: string) => void
    setExpanded: Dispatch<SetStateAction<Set<string>>>
    select: (path: string | null) => void
    copyPath: (path: string) => void
    download: (path: string, isFolder: boolean) => void
}) {
    return flatRows.length === 0 ? (
        <Text type="secondary" className="px-1 !text-xs">
            {searchLoading ? "Searching all files…" : "No files match."}
        </Text>
    ) : (
        // Only the visible rows mount. Full pane width; each row handles its
        // own horizontal overflow, so there's no tree-wide horizontal axis.
        <div
            style={{
                height: treeVirtualizer.getTotalSize(),
                position: "relative",
                width: "100%",
            }}
        >
            {treeVirtualizer.getVirtualItems().map((vRow) => {
                const row = flatRows[vRow.index]
                const {node, depth} = row
                const parent = parentOf(node.path)
                // One-shot entrance: only the rows of a level that resolved
                // THIS render animate in (staggered by sibling order), so the
                // skeleton→content swap settles gracefully. Empty on every
                // other render → the virtualizer's scroll remounts don't replay.
                const reveal =
                    !row.loading && (justLoadedDirs.has(parent) || firstEverPaths.has(node.path))
                // Folder rows are drop targets: spring-load + upload, with a
                // tint while hovered.
                const rowFolderDrop =
                    node.isFolder && canUpload ? drop.folderDropProps(node.path) : undefined
                return (
                    <div
                        key={vRow.key}
                        data-index={vRow.index}
                        ref={measureRow}
                        className={
                            drop.hoverPath === node.path
                                ? "rounded bg-[var(--ant-color-primary-bg)]"
                                : undefined
                        }
                        style={{
                            position: "absolute",
                            top: 0,
                            left: 0,
                            width: "100%",
                            transform: `translateY(${vRow.start}px)`,
                        }}
                        {...rowFolderDrop}
                    >
                        <motion.div {...revealFade(reveal)}>
                            {row.loading ? (
                                <TreeLoadingRow depth={depth} width={row.loadingWidth} />
                            ) : (
                                <DriveItemContextMenu
                                    path={node.path}
                                    isFolder={node.isFolder}
                                    onOpen={() => select(node.path)}
                                    onCopyPath={copyPath}
                                    onDownload={download}
                                    className="w-full"
                                >
                                    <TreeRow
                                        node={node}
                                        depth={depth}
                                        isOpen={shownExpanded.has(node.path)}
                                        selected={node.path === selectedPath}
                                        loading={
                                            node.isFolder &&
                                            shownExpanded.has(node.path) &&
                                            node.children.length === 0 &&
                                            isDirLoading(node.path)
                                        }
                                        showOrigin={showOrigin}
                                        parent={parent}
                                        scrollX={scrollXFor(parent)}
                                        onMeasureContent={onMeasureContent}
                                        pending={pendingUploadByPath.get(node.path)}
                                        onRetryUpload={onRetryUpload}
                                        onDismissUpload={onDismissUpload}
                                        onToggle={(path) =>
                                            setExpanded((prev) => {
                                                const next = new Set(prev)
                                                if (next.has(path)) next.delete(path)
                                                else next.add(path)
                                                return next
                                            })
                                        }
                                        onSelect={select}
                                    />
                                </DriveItemContextMenu>
                            )}
                        </motion.div>
                    </div>
                )
            })}
        </div>
    )
}
