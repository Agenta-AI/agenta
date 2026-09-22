import {useEffect, useRef} from "react"

import {querySessions} from "@agenta/entities/session"
import {retrieveWorkflowRevision} from "@agenta/entities/workflow"
import {isValidUUID} from "@agenta/shared/utils"
import {useQuery} from "@tanstack/react-query"

/**
 * The revision a bound id names, whichever level the id lives at.
 *
 * The route's `?agent=` is a WORKFLOW id when Home or the rail minted the session, but a trigger
 * written through the SDK or the API binds only a variant or a revision, and an automation's
 * test run hands that leaf id over as-is. Each level costs one request and the common case
 * stays at one: the workflow lookup goes first, the others run only on a miss.
 */
export const retrieveBoundRevision = async (projectId: string, boundId: string) => {
    const refs = [
        {workflowRef: {id: boundId}},
        {workflowVariantRef: {id: boundId}},
        {workflowRevisionRef: {id: boundId}},
    ]
    for (const ref of refs) {
        const revision = await retrieveWorkflowRevision({projectId, ...ref})
        if (revision?.id) {
            return {revisionId: revision.id, workflowId: revision.workflow_id ?? null}
        }
    }
    return null
}

/**
 * The cache key for an agent's latest revision. It sits UNDER `["workflows", "latestRevision"]`
 * on purpose: that is the prefix `invalidateAgentCommittedRevisionCache` clears after every
 * commit — the config pane's auto-save, the agent committing itself, a `workflow-changed` watch
 * event — and a key of this app's own was reached by none of them. A session that was not
 * pinned then resolved through a snapshot taken when the page first asked, so a new tab, or a
 * switch to one without a pin, showed a revision several commits old.
 */
export const agentLatestRevisionQueryKey = (projectId: string, boundId: string | null) =>
    ["workflows", "latestRevision", "mobile", projectId, boundId] as const

/**
 * The id a session row binds its agent by. The WORKFLOW ref when the row carries one — a
 * revision ref beside it names the turn that ran, not what the workspace should follow — else
 * the first ref that is an id at all (a trigger may bind a variant or a revision only).
 */
export const boundReferenceId = (
    references: {key?: string | null; id?: string | null}[] | null | undefined,
): string | null => {
    if (!references?.length) return null
    const workflow = references.find(
        (ref) => ref.key === "workflow" && ref.id && isValidUUID(ref.id),
    )
    return workflow?.id ?? references.find((ref) => ref.id && isValidUUID(ref.id))?.id ?? null
}

/**
 * Resolve the entity the conversation engine invokes: session → owning agent (the latest
 * turn's workflow reference, off `/sessions/query`) → that agent's LATEST revision id. The engine's
 * request builder reads everything else (invocation URL, config, references) off the workflow
 * molecule, which self-fetches by this revision id.
 *
 * Null while resolving or for a session with no turns yet (no references → nothing to invoke);
 * the composer disables itself on null. `fallbackAgentId` covers exactly that case for a
 * session Home just minted: it has no turns to name its agent, so the route carries it. It may
 * be a variant or revision id (see `retrieveBoundRevision`); the `agentId` returned is always
 * the WORKFLOW id once the revision is known, so the rail scope, the tool displays and the
 * "+" never see a leaf id.
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
    const listedAgentId = boundReferenceId(row?.references)
    const boundId = listedAgentId ?? fallbackAgentId ?? null

    const revisionQuery = useQuery({
        queryKey: agentLatestRevisionQueryKey(projectId, boundId),
        queryFn: () => retrieveBoundRevision(projectId, boundId ?? ""),
        enabled: Boolean(boundId && projectId),
        staleTime: 30_000,
        refetchOnWindowFocus: false,
    })

    // The project key means nothing here remounts per session, so a list cached before this
    // session existed would never be re-read. Re-read once per missing session — a session with
    // no turns yet is a real miss, so never retry beyond that.
    const {isSuccess, isFetching, refetch} = sessionsQuery
    const missedRef = useRef<string | null>(null)
    const missing = isSuccess && !row && !fallbackAgentId
    useEffect(() => {
        if (!missing || missedRef.current === sessionId) return
        missedRef.current = sessionId
        void refetch()
    }, [missing, sessionId, refetch])

    // A route-supplied agent IS the answer, so do not gate the screen on a list fetch that by
    // definition cannot contain a session the client minted a moment ago.
    const awaitingList = (sessionsQuery.isPending || (missing && isFetching)) && !fallbackAgentId

    return {
        agentId: revisionQuery.data?.workflowId ?? boundId,
        entityId: revisionQuery.data?.revisionId ?? null,
        resolving: awaitingList || (Boolean(boundId) && revisionQuery.isPending),
    }
}
