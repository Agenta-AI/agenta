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
    const agentQuery = useQuery({
        queryKey: ["mobile", "session-agent", projectId, sessionId],
        queryFn: async () => {
            // `/sessions/query` rows carry the latest turn's workflow references (WP0-R3);
            // the raw stream row does NOT — references are stamped per turn.
            const rows = await querySessions({projectId, sessionIds: [sessionId]})
            // THIS session's row or nothing. The fallback here used to be `?? rows[0]`, which
            // adopts a DIFFERENT session's agent whenever the response does not carry the one we
            // asked for — a silent cross-session answer, cached for the full staleTime below.
            const row = rows?.find((candidate) => candidate.session_id === sessionId)
            // No row is a real answer for a session with no turns yet, so null rather than a
            // throw. What is NOT an answer is another session's row.
            return row?.references?.find((ref) => ref.id && isValidUUID(ref.id))?.id ?? null
        },
        enabled: Boolean(sessionId && projectId),
        staleTime: 60_000,
        refetchOnWindowFocus: false,
    })
    const agentId = agentQuery.data ?? fallbackAgentId ?? null

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

    return {
        agentId,
        entityId: revisionQuery.data ?? null,
        resolving: agentQuery.isPending || (Boolean(agentId) && revisionQuery.isPending),
    }
}
