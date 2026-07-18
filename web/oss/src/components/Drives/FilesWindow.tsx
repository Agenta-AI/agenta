/**
 * FilesWindow — the chat-mode "Files" surface (build-spec view E2). Jargon-free: never says
 * mount/cwd/session drive. Three views: FLAT (every file, one tiled list), FOLDERS (drill in via a
 * breadcrumb — the default, usable at any scale), and LIST (the same two-pane tree explorer the
 * Build drawer uses — shared, not duplicated). One toolbar (search + origin filter + sort) drives
 * all three; search + origin flow into the tree via props. Read-only in phase 1.
 */
import {useDeferredValue, useMemo, useState} from "react"

import {
    Eye,
    EyeClosed,
    FolderSimple,
    ListBullets,
    MagnifyingGlass,
    SquaresFour,
    Tray,
} from "@phosphor-icons/react"
import {Button, Input, Segmented, Select, Skeleton, Tooltip, Typography} from "antd"
import {useSetAtom} from "jotai"

import {DriveBreadcrumb, DriveExplorer, driveRootLabel, FolderTile} from "./DriveExplorer"
import {DriveFileRow} from "./DriveFileRow"
import {gridArrowKeyDown} from "./driveKeyboard"
import {useDriveArtifactId} from "./driveSessionContext"
import {buildDriveTree, humanSize, isHiddenPath, type DriveTreeNode} from "./driveTree"
import {ORIGIN_TIP} from "./OriginTag"
import {driveQuickLookAtomFamily} from "./quickLook"
import {isRecentlyChanged, useRecentChangeClock} from "./recentChange"
import {fileOrigin, useSessionDrive, type DriveRecentFile, type FileOrigin} from "./useSessionDrive"
import {VirtualTileGrid} from "./VirtualTileGrid"

const {Text} = Typography

type SortKey = "recent" | "name" | "size"
type OriginFilter = "all" | FileOrigin

export default function FilesWindow({
    sessionId,
    embedded = false,
}: {
    sessionId: string
    /** Rendered inside a titled shell (the Files drawer) — hide the inner "Files" label. */
    embedded?: boolean
}) {
    const artifactId = useDriveArtifactId()
    const drive = useSessionDrive(sessionId, artifactId ?? undefined)
    const openQuickLook = useSetAtom(driveQuickLookAtomFamily(sessionId))
    const now = useRecentChangeClock(drive.lastTouchedAt)

    // flat = every file, one tiled list; folders = drill into folders (breadcrumb); list = the
    // two-pane tree explorer. `folders` is the default (browsable at any scale); flat is kept as an
    // option per the ask.
    const [view, setView] = useState<"flat" | "folders" | "list">("folders")
    const [search, setSearch] = useState("")
    const [sort, setSort] = useState<SortKey>("recent")
    const [origin, setOrigin] = useState<OriginFilter>("all")
    // Show dot-prefixed (hidden) files/folders. On by default (surfaced dimmed); toggle off to declutter.
    const [showHidden, setShowHidden] = useState(true)
    // Current folder being browsed ("" = drive root). Only meaningful in the `folders` view.
    const [folderPath, setFolderPath] = useState("")

    // Offer the agent/session filter only when the drive actually holds both kinds.
    const mixed = useMemo(() => {
        const kinds = new Set(drive.recents.map((f) => fileOrigin(f.path)))
        return kinds.has("agent") && kinds.has("session")
    }, [drive.recents])

    // Defer the filter/sort work off the keystroke so typing stays responsive on a 12k-file drive.
    const deferredSearch = useDeferredValue(search)
    const query = deferredSearch.trim().toLowerCase()
    const searching = query.length > 0

    const recentsByPath = useMemo(
        () => new Map(drive.recents.map((f) => [f.path, f])),
        [drive.recents],
    )
    const tree = useMemo(() => buildDriveTree(drive.files), [drive.files])
    const nodeByPath = useMemo(() => {
        const map = new Map<string, DriveTreeNode>()
        const walk = (nodes: DriveTreeNode[]) => {
            for (const n of nodes) {
                map.set(n.path, n)
                if (n.children.length) walk(n.children)
            }
        }
        walk(tree)
        return map
    }, [tree])

    const sortFiles = <T extends {path: string; size?: number | null}>(files: T[]): T[] => {
        if (sort === "name")
            return [...files].sort((a, b) =>
                (a.path.split("/").pop() ?? "").localeCompare(b.path.split("/").pop() ?? ""),
            )
        if (sort === "size") return [...files].sort((a, b) => (b.size ?? 0) - (a.size ?? 0))
        // recent: by last-touched (from the recency-stamped listing), newest first
        return [...files].sort((a, b) => {
            const ta = recentsByPath.get(a.path)?.touchedAt ?? 0
            const tb = recentsByPath.get(b.path)?.touchedAt ?? 0
            return tb !== ta ? tb - ta : a.path.localeCompare(b.path)
        })
    }

    // FLAT: every file, origin-filtered + search-filtered + sorted. Powers the Flat view, and the
    // Folders view WHILE searching (search is a flat cross-folder match, not a per-folder one).
    const flatList = useMemo(() => {
        let files = drive.recents
        if (!showHidden) files = files.filter((f) => !isHiddenPath(f.path))
        if (mixed && origin !== "all") files = files.filter((f) => fileOrigin(f.path) === origin)
        if (query) files = files.filter((f) => f.path.toLowerCase().includes(query))
        return sortFiles(files)
    }, [drive.recents, query, mixed, origin, sort, showHidden, recentsByPath])

    // BROWSE: the current folder's children — folders first (alpha, from buildDriveTree), then files
    // (origin-filtered + sorted).
    const browseEntries = useMemo(() => {
        let children = folderPath === "" ? tree : (nodeByPath.get(folderPath)?.children ?? [])
        if (!showHidden) children = children.filter((n) => !isHiddenPath(n.path))
        const folders = children.filter((n) => n.isFolder)
        let files = children.filter((n) => !n.isFolder)
        if (mixed && origin !== "all") files = files.filter((n) => fileOrigin(n.path) === origin)
        return [...folders, ...sortFiles(files)]
    }, [folderPath, tree, nodeByPath, mixed, origin, sort, showHidden, recentsByPath])

    const rootLabel = driveRootLabel(drive.mount)

    const fileTile = (node: {path: string; size?: number | null}) => {
        const file = recentsByPath.get(node.path)
        const resolved = drive.resolveMount(node.path)
        return (
            <div className="min-w-0">
                <DriveFileRow
                    variant="tile"
                    path={node.path}
                    file={resolved && file ? {...file, path: resolved.path} : file}
                    mount={resolved?.mount ?? drive.mount}
                    showOrigin={mixed}
                    trailing={humanSize(node.size)}
                    recent={file ? isRecentlyChanged(file.touchedAt, now) : false}
                    onOpen={() => openQuickLook({path: node.path})}
                />
            </div>
        )
    }

    return (
        <div className="flex min-h-0 flex-1 flex-col">
            <div className="flex shrink-0 items-center gap-2 px-3 py-2">
                {!embedded ? (
                    <>
                        <FolderSimple size={15} className="text-colorTextSecondary" />
                        <span className="text-xs font-medium">Files</span>
                    </>
                ) : null}
                {/* Search on the LEFT so it sits over the tree pane (fills what would otherwise be
                    empty space above the tree, matching the build drawer). */}
                <Input
                    allowClear
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search all files"
                    className="w-[200px] max-w-[40%]"
                    prefix={<MagnifyingGlass size={12} className="text-colorTextQuaternary" />}
                />
                {/* Filters + sort + view. Search + origin drive the tree too (via props); sort is
                    tile-only (a tree is inherently ordered). */}
                <div className="ml-auto flex items-center gap-2">
                    {mixed ? (
                        <Segmented
                            value={origin}
                            onChange={(v) => setOrigin(v as OriginFilter)}
                            options={[
                                {value: "all", label: "All"},
                                {
                                    value: "agent",
                                    label: (
                                        <Tooltip title={ORIGIN_TIP.agent}>
                                            <span>Agent</span>
                                        </Tooltip>
                                    ),
                                },
                                {
                                    value: "session",
                                    label: (
                                        <Tooltip title={ORIGIN_TIP.session}>
                                            <span>Session</span>
                                        </Tooltip>
                                    ),
                                },
                            ]}
                        />
                    ) : null}
                    {view !== "list" ? (
                        <Select
                            value={sort}
                            onChange={setSort}
                            className="w-[92px]"
                            options={[
                                {value: "recent", label: "Recent"},
                                {value: "name", label: "Name"},
                                {value: "size", label: "Size"},
                            ]}
                        />
                    ) : null}
                    <Tooltip title={showHidden ? "Hide hidden files" : "Show hidden files"}>
                        <Button
                            type="text"
                            aria-label={showHidden ? "Hide hidden files" : "Show hidden files"}
                            aria-pressed={!showHidden}
                            icon={
                                showHidden ? (
                                    <Eye size={16} className="block" />
                                ) : (
                                    <EyeClosed size={16} className="block" />
                                )
                            }
                            onClick={() => setShowHidden((v) => !v)}
                            className={
                                showHidden ? "!text-colorTextTertiary" : "!text-colorPrimary"
                            }
                        />
                    </Tooltip>
                    <Segmented
                        value={view}
                        onChange={(v) => setView(v as "flat" | "folders" | "list")}
                        options={[
                            {
                                value: "flat",
                                label: (
                                    <Tooltip title="All files">
                                        <span className="flex h-full items-center justify-center">
                                            <SquaresFour size={16} />
                                        </span>
                                    </Tooltip>
                                ),
                            },
                            {
                                value: "folders",
                                label: (
                                    <Tooltip title="Browse folders">
                                        <span className="flex h-full items-center justify-center">
                                            <FolderSimple size={16} />
                                        </span>
                                    </Tooltip>
                                ),
                            },
                            {
                                value: "list",
                                label: (
                                    <Tooltip title="Tree">
                                        <span className="flex h-full items-center justify-center">
                                            <ListBullets size={16} />
                                        </span>
                                    </Tooltip>
                                ),
                            },
                        ]}
                    />
                </div>
            </div>

            {view === "list" ? (
                // Same explorer the build drawer uses (shared, not duplicated); the toolbar search +
                // origin filter drive it via props.
                <div className="flex min-h-0 flex-1">
                    <DriveExplorer
                        drive={drive}
                        scope="session"
                        search={deferredSearch}
                        originFilter={origin}
                        showHidden={showHidden}
                    />
                </div>
            ) : drive.errored ? (
                <div className="px-3 py-4">
                    <Text type="secondary" className="!text-xs">
                        Couldn&rsquo;t load this conversation&rsquo;s files.
                    </Text>
                </div>
            ) : drive.isLoading ? (
                <div className="px-3 py-2">
                    <Skeleton active paragraph={{rows: 4}} />
                </div>
            ) : drive.fileCount === 0 ? (
                <div className="flex flex-1 flex-col items-center justify-center gap-1 p-8 text-center">
                    <Tray size={26} className="text-colorTextQuaternary" />
                    <div className="text-xs font-medium">No files yet</div>
                    <div className="text-[11px] text-colorTextTertiary">
                        Files the agent creates in this conversation show up here.
                    </div>
                </div>
            ) : (
                <>
                    {/* Breadcrumb only in the Folders view (browsing); flat + searching are flat lists. */}
                    {view === "folders" && !searching ? (
                        <div className="shrink-0 px-3 pb-1">
                            <DriveBreadcrumb
                                shown={folderPath}
                                rootLabel={rootLabel}
                                onNavigate={setFolderPath}
                            />
                        </div>
                    ) : null}

                    {view === "flat" || searching ? (
                        flatList.length === 0 ? (
                            <div className="min-h-0 flex-1 p-3">
                                <Text type="secondary" className="!text-[11px]">
                                    No files match.
                                </Text>
                            </div>
                        ) : (
                            <VirtualTileGrid
                                items={flatList}
                                minColumnWidth={200}
                                className="px-3 pt-1"
                                onKeyDown={gridArrowKeyDown}
                                getKey={(file) => file.path}
                                renderTile={(file: DriveRecentFile) => fileTile(file)}
                            />
                        )
                    ) : browseEntries.length === 0 ? (
                        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-1 p-8 text-center">
                            <Tray size={26} className="text-colorTextQuaternary" />
                            <div className="text-xs font-medium">Empty folder</div>
                        </div>
                    ) : (
                        // Windowed: only the visible tiles mount, so a 12k-file drive stays smooth.
                        <VirtualTileGrid
                            // Remount per folder so drilling in starts scrolled at the top.
                            key={folderPath}
                            items={browseEntries}
                            minColumnWidth={200}
                            className="px-3 pt-1"
                            onKeyDown={gridArrowKeyDown}
                            getKey={(n) => n.path}
                            renderTile={(n: DriveTreeNode) =>
                                n.isFolder ? (
                                    <FolderTile node={n} onOpen={() => setFolderPath(n.path)} />
                                ) : (
                                    fileTile(n)
                                )
                            }
                        />
                    )}
                    <div className="shrink-0 border-0 border-t border-solid border-colorBorderSecondary px-3 py-1.5 text-[11px] text-colorTextTertiary">
                        {drive.fileCount} file{drive.fileCount === 1 ? "" : "s"} ·{" "}
                        {humanSize(drive.totalSize) || "0 B"} · click a tile to Quick Look
                    </div>
                </>
            )}
        </div>
    )
}
