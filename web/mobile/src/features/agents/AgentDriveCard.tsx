import {useMemo} from "react"

import {
    AGENT_FILES_DIR,
    agentDrivesStateForParameters,
    driveDir,
    type Drive,
} from "@agenta/entities/drive"
import {agentLatestRevisionAtomFamily} from "@agenta/entity-ui/agent"
import {
    DriveFolderGlyph,
    driveQuickLookAtomFamily,
    sessionFilesPaneOpenAtomFamily,
} from "@agenta/entity-ui/drive"
import {useAtomValue, useStore} from "jotai"

import {useStartBlankSession} from "../chat/useStartBlankSession"

import {AgentOverviewCard} from "./AgentOverviewCard"
import {AgentOverviewCardRow} from "./AgentOverviewCardRow"
import {AgentOverviewCardError} from "./states/AgentOverviewCardError"
import {AgentOverviewCardSkeleton} from "./states/AgentOverviewCardSkeleton"

interface DriveRow {
    folder: string
    readOnly: boolean
}

/** The home drive first, at `agent-files/`, then each other drive at `drives/<slug>/`. */
export const agentDriveRows = (home: boolean, drives: readonly Drive[]): DriveRow[] => [
    ...(home ? [{folder: AGENT_FILES_DIR, readOnly: false}] : []),
    ...drives.map((d) => ({folder: driveDir(d.slug), readOnly: d.access === "read"})),
]

/** The drives of the agent's configuration. Opening one starts a session with the docked pane on it. */
export const AgentDriveCard = ({agentId, base}: {agentId: string; base: string}) => {
    const store = useStore()
    const startBlank = useStartBlankSession(base)

    // The drives are created with the agent, so its latest revision names them before any run.
    const revision = useAtomValue(useMemo(() => agentLatestRevisionAtomFamily(agentId), [agentId]))
    // A revision that did not load names no drives: the card shows the error, never the lookup
    // of a configuration without a `drives` list.
    const parameters =
        revision.isPending || revision.isError
            ? undefined
            : (revision.data?.data?.parameters ?? null)
    const drivesAtom = useMemo(
        () => agentDrivesStateForParameters(parameters, agentId),
        [parameters, agentId],
    )
    const drives = useAtomValue(drivesAtom)
    const rows = agentDriveRows(Boolean(drives.homeMount), drives.otherDrives)
    const failed = revision.isError || (drives.isError && rows.length === 0)
    const retry = () => (revision.isError ? void revision.refetch() : drives.refetch())

    // Seed the pane's state before the route changes; both atoms are read on mount.
    const openDrive = (folder: string | null) => {
        const sessionId = startBlank(agentId)
        store.set(sessionFilesPaneOpenAtomFamily(agentId), true)
        if (folder)
            store.set(driveQuickLookAtomFamily(sessionId), {
                path: folder,
                exact: true,
                folder: true,
            })
    }

    return (
        <AgentOverviewCard
            title="Files"
            action={rows.length ? "Open files" : undefined}
            onAction={() => openDrive(null)}
        >
            {failed ? (
                <AgentOverviewCardError message="Couldn't load files." onRetry={retry} />
            ) : drives.isPending ? (
                <AgentOverviewCardSkeleton rows={2} />
            ) : rows.length === 0 ? (
                <p className="m-0 py-2 text-[13px] text-muted-foreground">
                    This agent has no drive yet.
                </p>
            ) : (
                rows.map((row) => (
                    <AgentOverviewCardRow
                        key={row.folder}
                        icon={<DriveFolderGlyph size={16} />}
                        label={`${row.folder}/`}
                        detail={row.readOnly ? "read only" : null}
                        title={row.folder}
                        onClick={() => openDrive(row.folder)}
                        className="py-1.5"
                    />
                ))
            )}
        </AgentOverviewCard>
    )
}
