/**
 * Shared state for the config panel's "Files" region, split across two DOM locations: the header
 * bar (rendered by the entity-ui `AgentOperationsSections`) shows the count and opens the drawer;
 * the body (`StorageSection`) lists recents and opens the same drawer preselected on a row. Both
 * resolve the same session/artifact drive via {@link useConfigDrive} and share one drawer request
 * via {@link configFilesDrawerAtomFamily}, keyed by the edited revision.
 */
import {atom, useAtomValue} from "jotai"
import {atomFamily} from "jotai/utils"

import {workflowMolecule} from "@agenta/entities/workflow"

import {type DroppedFile} from "./dropEntries"
import {useSessionDriveSummary, type SessionDriveData} from "./useSessionDrive"

export interface ConfigFilesDrawerRequest {
    open: boolean
    /** Preselect this path in the tree/preview when opening; null opens at the root. */
    initialPath: string | null
    /** Files dropped on the Files peek, staged (unwritten) until a destination is chosen in the drawer. */
    staged: DroppedFile[]
}

/** One drawer-open request per config revision, shared by the Files header and body. */
export const configFilesDrawerAtomFamily = atomFamily((_revisionId: string) =>
    atom<ConfigFilesDrawerRequest>({open: false, initialPath: null, staged: []}),
)

/**
 * The drive backing the config panel's Files region: the conversation's cwd mount plus the
 * agent's durable folder (resolved from the edited revision's artifact).
 *
 * The SESSION is the host's to resolve and is passed in — the desktop derives it from its open
 * chat tabs (a stale active id falls back to the first open tab, a never-run tab resolves to
 * none), a session-scoped surface already knows it. An empty id holds the queries off, which is
 * the "open a conversation to browse them here" state.
 */
export function useConfigDrive(
    revisionId?: string | null,
    sessionId?: string | null,
): {
    drive: SessionDriveData
    sessionId: string
    artifactId?: string
} {
    const artifactId = useAtomValue(workflowMolecule.selectors.workflowId(revisionId ?? ""))
    const resolvedSessionId = sessionId ?? ""

    // Summary only: the config header/body show a count + the latest handful. The browse drawer
    // gets its own full drive, gated on open (see StorageSection), so the whole tree is never
    // fetched just to render this always-mounted section.
    const drive = useSessionDriveSummary(resolvedSessionId, artifactId ?? undefined)
    return {drive, sessionId: resolvedSessionId, artifactId: artifactId ?? undefined}
}
