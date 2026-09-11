import {useMemo, useState} from "react"

import {AGENT_FILES_DIR, agentMountQueryFamily, useSessionDrive} from "@agenta/entities/drive"
import {latestMountFilesQueryFamily, type MountFile} from "@agenta/entities/session"
import {File, Folder} from "@phosphor-icons/react"
import {useAtomValue} from "jotai"
import dynamic from "next/dynamic"

import {AgentOverviewCard} from "./AgentOverviewCard"
import {AgentOverviewCardRow} from "./AgentOverviewCardRow"
import {AgentOverviewCardSkeleton} from "./states/AgentOverviewCardSkeleton"

// The whole drive explorer, pulled in only once the drawer is actually opened.
const FilesDrawer = dynamic(
    () => import("@agenta/entity-ui/drive").then((mod) => mod.FilesDrawer),
    {ssr: false},
)

const ICON = 14
/** The card shows this many, newest first, and never more: the drawer is where the whole drive lives. */
const LIMIT = 5

const formatSize = (bytes: number | null | undefined): string | null => {
    if (bytes == null) return null
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

const fileDetail = (file: MountFile): string | null =>
    file.is_folder
        ? file.item_count != null
            ? `${file.item_count} item${file.item_count === 1 ? "" : "s"}`
            : null
        : formatSize(file.size)

/**
 * The agent's OWN drive — the files it carries between runs, not a session's scratch mount. The
 * same mount and file queries the shared card reads, so this and the drawer share one cache.
 */
export const AgentDriveCard = ({agentId}: {agentId: string}) => {
    const [openPath, setOpenPath] = useState<string | null>(null)
    const [open, setOpen] = useState(false)

    const mountsAtom = useMemo(() => agentMountQueryFamily(agentId), [agentId])
    const mounts = useAtomValue(mountsAtom)
    const mountId = mounts.data?.id ?? ""

    const filesAtom = useMemo(
        () => latestMountFilesQueryFamily({mountId, limit: LIMIT, order: "recent"}),
        [mountId],
    )
    const files = useAtomValue(filesAtom)
    // No session id: only the agent mount loads, and only once the drawer is open.
    const drive = useSessionDrive("", open ? agentId : undefined)

    const rows: MountFile[] = files.data?.files ?? []
    const isPending = mounts.isPending || (Boolean(mountId) && files.isPending)

    const openDrive = (path: string | null) => {
        setOpenPath(path)
        setOpen(true)
    }

    return (
        <AgentOverviewCard
            title="Files"
            action={mountId ? "Open files" : undefined}
            onAction={() => openDrive(null)}
        >
            {isPending ? (
                <AgentOverviewCardSkeleton rows={3} />
            ) : rows.length === 0 ? (
                <p className="m-0 py-2 text-[13px] text-muted-foreground">
                    {mountId
                        ? "This agent isn't carrying any files yet."
                        : "This agent has no drive yet."}
                </p>
            ) : (
                rows.map((file) => (
                    <AgentOverviewCardRow
                        key={file.path}
                        icon={file.is_folder ? <Folder size={ICON} /> : <File size={ICON} />}
                        label={file.path.split("/").filter(Boolean).pop() || file.path}
                        detail={fileDetail(file)}
                        title={file.path}
                        // The drive folds the agent mount in under `agent-files/`.
                        onClick={() => openDrive(`${AGENT_FILES_DIR}/${file.path}`)}
                        className="py-1.5"
                    />
                ))
            )}

            {open ? (
                <FilesDrawer
                    open={open}
                    onClose={() => {
                        setOpen(false)
                        setOpenPath(null)
                    }}
                    drive={drive}
                    scope="app"
                    initialPath={openPath}
                    driveIds={
                        mountId ? [{key: "mount", label: "Drive ID", value: mountId}] : undefined
                    }
                />
            ) : null}
        </AgentOverviewCard>
    )
}
