import {useMemo} from "react"

import {
    AGENT_FILES_DIR,
    agentMountQueryFamily,
    cleanPath,
    humanSize,
    itemCountLabel,
    nameOf,
} from "@agenta/entities/drive"
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

/** Newest first; the Files pane is where the whole drive lives. */
const LIMIT = 5

const fileDetail = (file: MountFile): string | null =>
    file.is_folder
        ? file.item_count != null
            ? itemCountLabel(file.item_count)
            : null
        : humanSize(file.size) || null

/** The agent's own drive. Opening a file starts a session with the docked pane on it. */
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

    // Seed the pane's state before the route changes; both atoms are read on mount.
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
                        icon={
                            file.is_folder ? (
                                <DriveFolderGlyph size={16} />
                            ) : (
                                <DriveTypeMark path={file.path} size="mini" />
                            )
                        }
                        label={nameOf(cleanPath(file.path)) || file.path}
                        detail={fileDetail(file)}
                        title={file.path}
                        onClick={() => openDrive(`${AGENT_FILES_DIR}/${file.path}`)}
                        className="py-1.5"
                    />
                ))
            )}
        </AgentOverviewCard>
    )
}
