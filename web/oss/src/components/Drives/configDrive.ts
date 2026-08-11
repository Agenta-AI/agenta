/**
 * Shared state for the config panel's "Files" region, split across two DOM locations: the header
 * bar (rendered by the entity-ui `AgentOperationsSections`) shows the count; the body
 * (`StorageSection`) lists recents. Both resolve the same session/artifact drive via
 * {@link useConfigDrive}, and both open the chat's docked Files pane (the per-session atoms in
 * `SessionFilesDrawer`/`quickLook`) rather than a drawer of their own.
 */
import {workflowMolecule} from "@agenta/entities/workflow"
import {useAtomValue} from "jotai"

import {useChatScopeKey} from "@/oss/components/AgentChatSlice/state/scope"
import {isSessionFresh} from "@/oss/components/AgentChatSlice/state/sessionEphemera"
import {
    activeSessionIdAtomFamily,
    sessionsListAtomFamily,
} from "@/oss/components/AgentChatSlice/state/sessions"

import {useSessionDriveSummary, type SessionDriveData} from "./useSessionDrive"

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
