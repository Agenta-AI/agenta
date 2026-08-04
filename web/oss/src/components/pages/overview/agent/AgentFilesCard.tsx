import {useMemo} from "react"

import {
    agentMountsQueryFamily,
    latestMountFilesQueryFamily,
    type MountFile,
} from "@agenta/entities/session"
import {FileIcon, FolderIcon} from "@phosphor-icons/react"
import {Skeleton, Tooltip} from "antd"
import {useAtomValue} from "jotai"

import {RAIL_CARD_CLASS} from "@/oss/assets/railCard"
import {timeAgo} from "@/oss/components/AgentChatSlice/state/sessions"

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
    const mountsAtom = useMemo(() => agentMountsQueryFamily(appId), [appId])
    const mounts = useAtomValue(mountsAtom)
    const mountId = mounts.data?.[0]?.id ?? ""

    const filesAtom = useMemo(
        () => latestMountFilesQueryFamily({mountId, limit: LIMIT, order: "recent"}),
        [mountId],
    )
    const files = useAtomValue(filesAtom)

    // `total` is the whole drive's count; `files` is only the slice this card asked for.
    const total = files.data?.total ?? null
    const rows: MountFile[] = files.data?.files ?? []
    const isPending = mounts.isPending || (Boolean(mountId) && files.isPending)

    return (
        <section className={`flex flex-col ${RAIL_CARD_CLASS}`}>
            <div className="mb-1 flex items-center justify-between gap-2">
                <h3 className="m-0 text-xs font-medium text-colorText">Files</h3>
                {total ? (
                    <span className="text-xs text-colorTextTertiary">
                        {total}
                        {files.data?.totalCapped ? "+" : ""} file{total === 1 ? "" : "s"}
                    </span>
                ) : null}
            </div>

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
                        <div
                            key={file.path}
                            className="flex items-center gap-2 border-0 border-b border-solid border-colorBorderSecondary px-2 py-2 last:border-b-0"
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
                            {detail ? (
                                <span className="shrink-0 text-[11px] text-colorTextTertiary">
                                    {detail}
                                </span>
                            ) : null}
                            {file.mtime ? (
                                <span className="w-14 shrink-0 text-right text-[11px] text-colorTextTertiary">
                                    {timeAgo(file.mtime)}
                                </span>
                            ) : null}
                        </div>
                    )
                })
            )}
        </section>
    )
}

export default AgentFilesCard
