import {useMemo, useState} from "react"

import {latestMountFilesQueryFamily, type MountFile} from "@agenta/entities/session"
import {FileIcon, FolderIcon} from "@phosphor-icons/react"
import {Skeleton, Tooltip} from "antd"
import {useAtomValue} from "jotai"

import {timeAgo} from "@/oss/components/AgentChatSlice/state/sessions"
import {agentMountQueryFamily} from "@/oss/components/Drives/agentDrive"
import {FilesDrawer} from "@/oss/components/Drives/FilesDrawer"
import {AGENT_FILES_DIR, useSessionDrive} from "@/oss/components/Drives/useSessionDrive"
import {PanelSection} from "@/oss/components/PanelSection"

/** Enough to show what the agent is carrying without turning the card into an explorer. */
const LIMIT = 6

const formatSize = (bytes: number | null | undefined): string | null => {
    if (bytes == null) return null
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * The agent's OWN drive — the files it carries between runs (its brief, its reference material),
 * not a session's scratch mount. Read-only here: the card says what is there and how recently it
 * changed; the drive itself is browsed and edited where drives are browsed and edited.
 */
const AgentFilesCard = ({appId}: {appId: string}) => {
    const [openPath, setOpenPath] = useState<string | null>(null)
    const [open, setOpen] = useState(false)

    // The app's own drive family — shared with the config panel and chat, so this card and the
    // drawer it opens read one cache entry rather than each fetching the mount.
    const mountsAtom = useMemo(() => agentMountQueryFamily(appId), [appId])
    const mounts = useAtomValue(mountsAtom)
    const mountId = mounts.data?.id ?? ""

    const filesAtom = useMemo(
        () => latestMountFilesQueryFamily({mountId, limit: LIMIT, order: "recent"}),
        [mountId],
    )
    const files = useAtomValue(filesAtom)
    // The FULL drive, not the summary: the summary's listing comes from a session's record
    // recency, which an agent-only surface has none of — it opened the drawer on an empty tree.
    // No session id, so the session half of this stays disabled and only the agent mount loads.
    const drive = useSessionDrive("", open ? appId : undefined)

    // `total` is the whole drive's count; `files` is only the slice this card asked for.
    const total = files.data?.total ?? null
    const rows: MountFile[] = files.data?.files ?? []
    const isPending = mounts.isPending || (Boolean(mountId) && files.isPending)

    return (
        <PanelSection
            title="Files"
            titleExtra={
                total ? (
                    <span className="shrink-0 text-xs text-colorTextTertiary">
                        {total}
                        {files.data?.totalCapped ? "+" : ""} file{total === 1 ? "" : "s"}
                    </span>
                ) : null
            }
            extra={
                mountId ? (
                    <button
                        type="button"
                        onClick={() => {
                            // No path: the drawer opens on the drive root rather than a selection.
                            setOpenPath(null)
                            setOpen(true)
                        }}
                        className="shrink-0 cursor-pointer border-0 bg-transparent p-0 text-xs text-colorPrimary"
                    >
                        View all
                    </button>
                ) : null
            }
        >
            {isPending ? (
                <Skeleton active paragraph={{rows: 3}} title={false} />
            ) : rows.length === 0 ? (
                <p className="m-0 px-2 py-3 text-xs text-colorTextTertiary">
                    {mountId
                        ? "This agent isn't carrying any files yet."
                        : "This agent has no drive yet."}
                </p>
            ) : (
                rows.map((file) => {
                    const name = file.path.split("/").filter(Boolean).pop() || file.path
                    const detail = file.is_folder
                        ? file.item_count != null
                            ? `${file.item_count} item${file.item_count === 1 ? "" : "s"}`
                            : null
                        : formatSize(file.size)

                    return (
                        <button
                            key={file.path}
                            type="button"
                            onClick={() => {
                                // The drive folds the agent mount in under `agent-files/`, so a
                                // raw mount path would select nothing.
                                setOpenPath(`${AGENT_FILES_DIR}/${file.path}`)
                                setOpen(true)
                            }}
                            className="group box-border flex w-full cursor-pointer items-center gap-2 border-0 border-b border-solid border-colorBorderSecondary bg-transparent px-2 py-2 text-left last:border-b-0 hover:bg-colorFillQuaternary"
                        >
                            {file.is_folder ? (
                                <FolderIcon size={14} className="shrink-0 text-colorTextTertiary" />
                            ) : (
                                <FileIcon size={14} className="shrink-0 text-colorTextTertiary" />
                            )}
                            <Tooltip title={file.path}>
                                <span className="min-w-0 flex-1 truncate text-xs text-colorText">
                                    {name}
                                </span>
                            </Tooltip>
                            {/* Fixed column: shrink-to-fit left "1.3 KB" and "293 B" without a shared edge. */}
                            <span className="w-16 shrink-0 text-right text-[11px] text-colorTextTertiary">
                                {detail}
                            </span>
                            {file.mtime ? (
                                <span className="w-14 shrink-0 text-right text-[11px] text-colorTextTertiary">
                                    {timeAgo(file.mtime)}
                                </span>
                            ) : null}
                        </button>
                    )
                })
            )}

            {/* The one Files drawer, in app scope — the same explorer the config panel and chat
                open, so a file opens the same way wherever you clicked it. */}
            <FilesDrawer
                open={open}
                onClose={() => {
                    setOpen(false)
                    setOpenPath(null)
                }}
                drive={drive}
                scope="app"
                initialPath={openPath}
                driveIds={mountId ? [{key: "mount", label: "Drive ID", value: mountId}] : undefined}
            />
        </PanelSection>
    )
}

export default AgentFilesCard
