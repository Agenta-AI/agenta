/**
 * FilesWindow — the chat-mode "Files" surface (build-spec view E2). Jargon-free: never says
 * mount/cwd/session drive. Grid (default) or List (the Build drawer's two-pane explorer — build
 * once, skin twice), with client-side search and Recent/Name/Size sort. Read-only in phase 1.
 *
 * The grid BROWSES FOLDERS (breadcrumb + folder tiles you drill into), not a flat dump of every
 * file — a flat grid is unusable once an agent clones a repo (thousands of files, no structure).
 * Searching flattens to matches across the whole tree; clearing search returns to the folder.
 */
import {useDeferredValue, useMemo, useState} from "react"

import {FolderSimple, ListBullets, MagnifyingGlass, SquaresFour, Tray} from "@phosphor-icons/react"
import {Input, Segmented, Select, Skeleton, Tooltip, Typography} from "antd"
import {useSetAtom} from "jotai"

import {DriveBreadcrumb, DriveExplorer, driveRootLabel, FolderTile} from "./DriveExplorer"
import {DriveFileRow} from "./DriveFileRow"
import {gridArrowKeyDown} from "./driveKeyboard"
import {useDriveArtifactId} from "./driveSessionContext"
import {buildDriveTree, humanSize, type DriveTreeNode} from "./driveTree"
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

    const [view, setView] = useState<"grid" | "list">("grid")
    const [search, setSearch] = useState("")
    const [sort, setSort] = useState<SortKey>("recent")
    const [origin, setOrigin] = useState<OriginFilter>("all")
    // Current folder being browsed ("" = drive root). Only meaningful while NOT searching.
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

    // SEARCH: flat matches across the whole tree (files only).
    const searchResults = useMemo(() => {
        if (!searching) return []
        let files = drive.recents.filter((f) => f.path.toLowerCase().includes(query))
        if (mixed && origin !== "all") files = files.filter((f) => fileOrigin(f.path) === origin)
        return sortFiles(files)
    }, [drive.recents, query, searching, mixed, origin, sort, recentsByPath])

    // BROWSE: the current folder's children — folders first (alpha, from buildDriveTree), then files
    // (origin-filtered + sorted).
    const browseEntries = useMemo(() => {
        const children = folderPath === "" ? tree : (nodeByPath.get(folderPath)?.children ?? [])
        const folders = children.filter((n) => n.isFolder)
        let files = children.filter((n) => !n.isFolder)
        if (mixed && origin !== "all") files = files.filter((n) => fileOrigin(n.path) === origin)
        return [...folders, ...sortFiles(files)]
    }, [folderPath, tree, nodeByPath, mixed, origin, sort, recentsByPath])

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
                <div className="ml-auto flex items-center gap-2">
                    {view === "grid" ? (
                        <>
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
                            <Input
                                allowClear
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                                placeholder="Search all files"
                                className="w-[140px]"
                                prefix={
                                    <MagnifyingGlass
                                        size={12}
                                        className="text-colorTextQuaternary"
                                    />
                                }
                            />
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
                        </>
                    ) : null}
                    <Segmented
                        value={view}
                        onChange={(v) => setView(v as "grid" | "list")}
                        options={[
                            {value: "grid", icon: <SquaresFour size={14} />},
                            {value: "list", icon: <ListBullets size={14} />},
                        ]}
                    />
                </div>
            </div>

            {view === "list" ? (
                <div className="flex min-h-0 flex-1">
                    <DriveExplorer drive={drive} scope="session" />
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
                    {/* Breadcrumb only while browsing; searching is a flat cross-folder view. */}
                    {!searching ? (
                        <div className="shrink-0 px-3 pb-1">
                            <DriveBreadcrumb
                                shown={folderPath}
                                rootLabel={rootLabel}
                                onNavigate={setFolderPath}
                            />
                        </div>
                    ) : null}

                    {searching ? (
                        searchResults.length === 0 ? (
                            <div className="min-h-0 flex-1 p-3">
                                <Text type="secondary" className="!text-[11px]">
                                    No files match.
                                </Text>
                            </div>
                        ) : (
                            <VirtualTileGrid
                                items={searchResults}
                                columns={3}
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
                            columns={3}
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
