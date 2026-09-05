import {querySessions} from "@agenta/entities/session"
import {retrieveWorkflowRevision} from "@agenta/entities/workflow"
import {isValidUUID} from "@agenta/shared/utils"
import {useQuery} from "@tanstack/react-query"

/**
 * Resolve the entity the conversation engine invokes: session → owning agent (the latest
 * turn's workflow reference, off `/sessions/query`) → that agent's LATEST revision id. The engine's
 * request builder reads everything else (invocation URL, config, references) off the workflow
 * molecule, which self-fetches by this revision id.
 *
 * Null while resolving or for a session with no turns yet (no references → nothing to invoke);
 * the composer disables itself on null. `fallbackAgentId` covers exactly that case for a
 * session Home just minted: it has no turns to name its agent, so the route carries it.
 */
export const useAgentEntity = (
    sessionId: string,
    projectId: string,
    fallbackAgentId?: string | null,
) => {
    // Keyed by PROJECT, not session. The response is the same whole-project list whichever
    // session asks for it, so a per-session key refetched all of it once per session opened.
    const sessionsQuery = useQuery({
        queryKey: ["mobile", "project-sessions", projectId],
        queryFn: async () => {
            // `/sessions/query` rows carry the latest turn's workflow references (WP0-R3);
            // the raw stream row does NOT — references are stamped per turn.
            // NOT `sessionIds`. That filter matches the row's `session_id`, which is a different
            // value from the `id` the route carries (v4 vs v7), so it returns ZERO rows.
            return (await querySessions({projectId})) ?? []
        },
        enabled: Boolean(projectId),
        staleTime: 60_000,
        refetchOnWindowFocus: false,
    })
    // Match on `id` — the session STREAM id, which is what the route carries. A row also has a
    // `session_id`, and it is a different value entirely (v4 where `id` is v7), so matching on
    // that never hit; the miss used to fall through to `rows[0]` and resolve the WRONG agent.
    const row = sessionsQuery.data?.find(
        (candidate) => candidate.id === sessionId || candidate.session_id === sessionId,
    )
    // No row is a real answer for a session with no turns yet. Another session's row is not.
    const listedAgentId = row?.references?.find((ref) => ref.id && isValidUUID(ref.id))?.id ?? null
    const agentId = listedAgentId ?? fallbackAgentId ?? null

    const revisionQuery = useQuery({
        queryKey: ["mobile", "agent-latest-revision", projectId, agentId],
        queryFn: async () => {
            const revision = await retrieveWorkflowRevision({
                projectId,
                workflowRef: {id: agentId ?? ""},
            })
            return revision?.id ?? null
        },
        enabled: Boolean(agentId && projectId),
        staleTime: 30_000,
        refetchOnWindowFocus: false,
    })

    // A route-supplied agent IS the answer, so do not gate the screen on a list fetch that by
    // definition cannot contain a session the client minted a moment ago.
    const awaitingList = sessionsQuery.isPending && !fallbackAgentId

    return {
        agentId,
        entityId: revisionQuery.data ?? null,
        resolving: awaitingList || (Boolean(agentId) && revisionQuery.isPending),
    }
}
