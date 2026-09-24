import {useEffect, useRef} from "react"

import {retrieveWorkflowRevision} from "@agenta/entities/workflow"
import {isValidUUID} from "@agenta/shared/utils"
import {useQuery} from "@tanstack/react-query"

import {useSessionHeader} from "./useSessionHeader"

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
 * Resolve the entity the conversation engine invokes: session → owning agent (the workflow
 * reference on the session's own stream row, shared with the tab bar's header read) → that
 * agent's LATEST revision id. The engine's request builder reads everything else (invocation URL,
 * config, references) off the workflow molecule, which self-fetches by this revision id.
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
    const header = useSessionHeader(projectId, sessionId)
    const row = header.data
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

    // No row may be a header cached before the first turn landed: re-read once, never more.
    const {isSuccess, isFetching, refetch} = header
    const missedRef = useRef<string | null>(null)
    const missing = isSuccess && !row && !fallbackAgentId
    useEffect(() => {
        if (!missing || missedRef.current === sessionId) return
        missedRef.current = sessionId
        void refetch()
    }, [missing, sessionId, refetch])

    // A route-supplied agent IS the answer; a just-minted session is not in the header yet.
    const awaitingHeader = (header.isPending || (missing && isFetching)) && !fallbackAgentId

    return {
        agentId: revisionQuery.data?.workflowId ?? boundId,
        entityId: revisionQuery.data?.revisionId ?? null,
        resolving: awaitingHeader || (Boolean(boundId) && revisionQuery.isPending),
    }
}
