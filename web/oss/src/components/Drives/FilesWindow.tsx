/**
 * FilesWindow — the chat-mode "Files" surface (build-spec view E2). Jargon-free: never says
 * mount/cwd/session drive. Grid (default, flat recent-first tiles → Quick Look) or List (the
 * Build drawer's two-pane explorer — build once, skin twice), with client-side search and
 * Recent/Name/Size sort. Read-only in phase 1, same endpoints as everything else.
 */
import {useDeferredValue, useMemo, useState} from "react"

import {FolderSimple, ListBullets, MagnifyingGlass, SquaresFour, Tray} from "@phosphor-icons/react"
import {Input, Segmented, Select, Skeleton, Tooltip, Typography} from "antd"
import {useSetAtom} from "jotai"

import {DriveExplorer} from "./DriveExplorer"
import {DriveFileRow} from "./DriveFileRow"
import {gridArrowKeyDown} from "./driveKeyboard"
import {useDriveArtifactId} from "./driveSessionContext"
import {humanSize} from "./driveTree"
import {ORIGIN_TIP} from "./OriginTag"
import {driveQuickLookAtomFamily} from "./quickLook"
import {isRecentlyChanged, useRecentChangeClock} from "./recentChange"
import {fileOrigin, useSessionDrive, type FileOrigin} from "./useSessionDrive"
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

    // Offer the agent/session filter only when the drive actually holds both kinds.
    const mixed = useMemo(() => {
        const kinds = new Set(drive.recents.map((f) => fileOrigin(f.path)))
        return kinds.has("agent") && kinds.has("session")
    }, [drive.recents])

    // Defer the filter/sort work off the keystroke so typing in the search box stays responsive on a
    // 12k-file drive (the input updates immediately; the heavy list recompute trails a frame).
    const deferredSearch = useDeferredValue(search)
    const shown = useMemo(() => {
        const q = deferredSearch.trim().toLowerCase()
        let filtered = drive.recents
        if (mixed && origin !== "all")
            filtered = filtered.filter((f) => fileOrigin(f.path) === origin)
        if (q) filtered = filtered.filter((f) => f.path.toLowerCase().includes(q))
        if (sort === "recent") return filtered // recents are already recency-ordered
        return [...filtered].sort((a, b) =>
            sort === "name"
                ? (a.path.split("/").pop() ?? "").localeCompare(b.path.split("/").pop() ?? "")
                : (b.size ?? 0) - (a.size ?? 0),
        )
    }, [drive.recents, deferredSearch, sort, origin, mixed])

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
                                placeholder="Search"
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
                    {shown.length === 0 ? (
                        <div className="min-h-0 flex-1 p-3">
                            <Text type="secondary" className="!text-[11px]">
                                No files match.
                            </Text>
                        </div>
                    ) : (
                        // Windowed: only the visible tiles mount, so a 12k-file drive stays smooth
                        // (each tile also mounts a thumbnail observer — never all at once).
                        <VirtualTileGrid
                            items={shown}
                            columns={3}
                            className="px-3 pt-3"
                            onKeyDown={gridArrowKeyDown}
                            getKey={(file) => file.path}
                            renderTile={(file) => {
                                // Thumbnail reads from the file's own mount (cwd or agent-files) with a
                                // mount-relative path; the tile shows the presented path.
                                const resolved = drive.resolveMount(file.path)
                                return (
                                    <div className="min-w-0">
                                        <DriveFileRow
                                            variant="tile"
                                            path={file.path}
                                            file={resolved ? {...file, path: resolved.path} : file}
                                            mount={resolved?.mount ?? drive.mount}
                                            showOrigin={mixed}
                                            trailing={humanSize(file.size)}
                                            recent={isRecentlyChanged(file.touchedAt, now)}
                                            onOpen={() => openQuickLook({path: file.path})}
                                        />
                                    </div>
                                )
                            }}
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
