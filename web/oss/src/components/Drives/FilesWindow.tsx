/**
 * FilesWindow — the chat-mode "Files" surface (build-spec view E2). Jargon-free: never says
 * mount/cwd/session drive. Grid (default, flat recent-first tiles → Quick Look) or List (the
 * Build drawer's two-pane explorer — build once, skin twice), with client-side search and
 * Recent/Name/Size sort. Read-only in phase 1, same endpoints as everything else.
 */
import {useMemo, useState} from "react"

import {FolderSimple, ListBullets, MagnifyingGlass, SquaresFour, Tray} from "@phosphor-icons/react"
import {Input, Segmented, Select, Skeleton, Typography} from "antd"
import {useSetAtom} from "jotai"

import {DriveExplorer} from "./DriveDrawer"
import {DriveFileRow} from "./DriveFileRow"
import {humanSize} from "./driveTree"
import {driveQuickLookAtomFamily} from "./quickLook"
import {isRecentlyChanged, useRecentChangeClock} from "./recentChange"
import {useSessionDrive} from "./useSessionDrive"

const {Text} = Typography

type SortKey = "recent" | "name" | "size"

export default function FilesWindow({
    sessionId,
    embedded = false,
}: {
    sessionId: string
    /** Rendered inside a titled shell (the Files drawer) — hide the inner "Files" label. */
    embedded?: boolean
}) {
    const drive = useSessionDrive(sessionId)
    const openQuickLook = useSetAtom(driveQuickLookAtomFamily(sessionId))
    const now = useRecentChangeClock(drive.lastTouchedAt)

    const [view, setView] = useState<"grid" | "list">("grid")
    const [search, setSearch] = useState("")
    const [sort, setSort] = useState<SortKey>("recent")

    const shown = useMemo(() => {
        const q = search.trim().toLowerCase()
        const filtered = q
            ? drive.recents.filter((f) => f.path.toLowerCase().includes(q))
            : drive.recents
        if (sort === "recent") return filtered // recents are already recency-ordered
        return [...filtered].sort((a, b) =>
            sort === "name"
                ? (a.path.split("/").pop() ?? "").localeCompare(b.path.split("/").pop() ?? "")
                : (b.size ?? 0) - (a.size ?? 0),
        )
    }, [drive.recents, search, sort])

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
                    <div className="grid min-h-0 flex-1 auto-rows-min grid-cols-3 gap-2 overflow-y-auto p-3">
                        {shown.map((file) => (
                            <DriveFileRow
                                key={file.path}
                                variant="tile"
                                path={file.path}
                                file={file}
                                mount={drive.mount}
                                trailing={humanSize(file.size)}
                                recent={isRecentlyChanged(file.touchedAt, now)}
                                onOpen={() => openQuickLook({path: file.path})}
                            />
                        ))}
                        {shown.length === 0 ? (
                            <Text type="secondary" className="col-span-3 !text-[11px]">
                                No files match.
                            </Text>
                        ) : null}
                    </div>
                    <div className="shrink-0 border-0 border-t border-solid border-colorBorderSecondary px-3 py-1.5 text-[11px] text-colorTextTertiary">
                        {drive.fileCount} file{drive.fileCount === 1 ? "" : "s"} ·{" "}
                        {humanSize(drive.totalSize) || "0 B"} · click a tile to Quick Look
                    </div>
                </>
            )}
        </div>
    )
}
