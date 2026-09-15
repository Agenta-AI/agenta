import {useMemo} from "react"

import {AGENT_FILES_DIR, agentMountQueryFamily} from "@agenta/entities/drive"
import {latestMountFilesQueryFamily, type MountFile} from "@agenta/entities/session"
import {
    DriveFolderGlyph,
    DriveTypeMark,
    driveQuickLookAtomFamily,
    sessionFilesPaneOpenAtomFamily,
} from "@agenta/entity-ui/drive"
import {useAtomValue, useStore} from "jotai"

import {useStartBlankSession} from "../chat/useStartBlankSession"

import {AgentOverviewCard} from "./AgentOverviewCard"
import {AgentOverviewCardRow} from "./AgentOverviewCardRow"
import {AgentOverviewCardSkeleton} from "./states/AgentOverviewCardSkeleton"

/** The card shows this many, newest first, and never more: the Files pane is where the whole drive lives. */
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
 * same mount and file queries the shared card reads, so this and the Files pane share one cache.
 * Opening a file (or "Open files") starts a session for the agent with the docked pane already
 * on it — the overview has no pane of its own.
 */
export const AgentDriveCard = ({agentId, base}: {agentId: string; base: string}) => {
    const store = useStore()
    const startBlank = useStartBlankSession(base)

    const mountsAtom = useMemo(() => agentMountQueryFamily(agentId), [agentId])
    const mounts = useAtomValue(mountsAtom)
    const mountId = mounts.data?.id ?? ""

    const filesAtom = useMemo(
        () => latestMountFilesQueryFamily({mountId, limit: LIMIT, order: "recent"}),
        [mountId],
    )
    const files = useAtomValue(filesAtom)

    const rows: MountFile[] = files.data?.files ?? []
    const isPending = mounts.isPending || (Boolean(mountId) && files.isPending)

    // Seed the pane's state BEFORE the route changes: the pane's open flag is keyed by the agent
    // (the workspace's scope) and a quick look by the new session, both read on mount.
    const openDrive = (path: string | null) => {
        const sessionId = startBlank(agentId)
        store.set(sessionFilesPaneOpenAtomFamily(agentId), true)
        if (path) store.set(driveQuickLookAtomFamily(sessionId), {path})
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
                        // The Files pane's own marks, so the card and the pane read as one drive.
                        icon={
                            file.is_folder ? (
                                <DriveFolderGlyph size={16} />
                            ) : (
                                <DriveTypeMark path={file.path} size="mini" />
                            )
                        }
                        label={file.path.split("/").filter(Boolean).pop() || file.path}
                        detail={fileDetail(file)}
                        title={file.path}
                        // The drive folds the agent mount in under `agent-files/`.
                        onClick={() => openDrive(`${AGENT_FILES_DIR}/${file.path}`)}
                        className="py-1.5"
                    />
                ))
            )}
        </AgentOverviewCard>
    )
}
