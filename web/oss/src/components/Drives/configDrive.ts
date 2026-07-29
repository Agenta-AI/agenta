/**
 * Shared state for the config panel's "Files" region, split across two DOM locations: the header
 * bar (rendered by the entity-ui `AgentOperationsSections`) shows the count and opens the drawer;
 * the body (`StorageSection`) lists recents and opens the same drawer preselected on a row. Both
 * resolve the same session/artifact drive via {@link useConfigDrive} and share one drawer request
 * via {@link configFilesDrawerAtomFamily}, keyed by the edited revision.
 */
import {workflowMolecule} from "@agenta/entities/workflow"
import {atom, useAtomValue} from "jotai"
import {atomFamily} from "jotai/utils"

import {useChatScopeKey} from "@/oss/components/AgentChatSlice/state/scope"
import {isSessionFresh} from "@/oss/components/AgentChatSlice/state/sessionEphemera"
import {
    activeSessionIdAtomFamily,
    sessionsListAtomFamily,
} from "@/oss/components/AgentChatSlice/state/sessions"

import {useSessionDriveSummary, type SessionDriveData} from "./useSessionDrive"

export interface ConfigFilesDrawerRequest {
    open: boolean
    /** Preselect this path in the tree/preview when opening; null opens at the root. */
    initialPath: string | null
}

/** One drawer-open request per config revision, shared by the Files header and body. */
export const configFilesDrawerAtomFamily = atomFamily((_revisionId: string) =>
    atom<ConfigFilesDrawerRequest>({open: false, initialPath: null}),
)

/**
 * The drive backing the config panel's Files region: the active conversation's cwd mount plus the
 * agent's durable folder (resolved from the edited revision's artifact). Resolves the session id
 * the same way the chat does — a stale active id (closed tab) falls back to the first open tab,
 * and a brand-new never-run tab holds the queries off until its first run.
 */
export function useConfigDrive(revisionId?: string | null): {
    drive: SessionDriveData
    sessionId: string
    artifactId?: string
} {
    const scope = useChatScopeKey()
    const artifactId = useAtomValue(workflowMolecule.selectors.workflowId(revisionId ?? ""))
    const sessions = useAtomValue(sessionsListAtomFamily(scope))
    const rawActiveId = useAtomValue(activeSessionIdAtomFamily(scope))
    const resolvedId = sessions.some((s) => s.id === rawActiveId)
        ? rawActiveId
        : (sessions[0]?.id ?? "")
    const sessionId = resolvedId && !isSessionFresh(resolvedId) ? resolvedId : ""

    // Summary only: the config header/body show a count + the latest handful. The browse drawer
    // gets its own full drive, gated on open (see StorageSection), so the whole tree is never
    // fetched just to render this always-mounted section.
    const drive = useSessionDriveSummary(sessionId, artifactId ?? undefined)
    return {drive, sessionId, artifactId: artifactId ?? undefined}
}
