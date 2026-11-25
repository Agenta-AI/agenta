import {useMemo} from "react"

import {
    retrievedWorkflowRevisionFamilyKey,
    retrievedWorkflowRevisionQueryAtomFamily,
    workflowArtifactQueryAtomFamily,
} from "@agenta/entities/workflow"
import {atom, useAtomValue} from "jotai"
import {atomFamily} from "jotai-family"

const UUID_SHAPED = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * The name of the agent that a tool call names by its slug or id (`start_session`), as the agent
 * lists show it. Undefined until it loads. When the agent cannot be found, a slug stands in for
 * the name; an id never does.
 */
const agentDisplayNameAtomFamily = atomFamily((ref: string) =>
    atom((get): string | undefined => {
        const isId = !!ref && UUID_SHAPED.test(ref)
        const key = retrievedWorkflowRevisionFamilyKey(
            ref ? {workflow: isId ? {id: ref} : {slug: ref}} : null,
        )
        const revision = get(retrievedWorkflowRevisionQueryAtomFamily(key))
        const workflowId = revision.data?.workflowId ?? ""
        const agent = get(workflowArtifactQueryAtomFamily(workflowId))
        const name =
            (workflowId && (agent.data?.name?.trim() || agent.data?.slug?.trim())) || undefined
        if (name) return name
        const notFound = revision.isError || (revision.isSuccess && !workflowId) || agent.isError
        return ref && !isId && notFound ? ref : undefined
    }),
)

export const useAgentDisplayName = (ref: string | undefined): string | undefined =>
    useAtomValue(agentDisplayNameAtomFamily(ref ?? ""))

/** `useAgentDisplayName` for several calls at once (a batch of approvals), by ref. */
export const useAgentDisplayNames = (
    refs: readonly string[],
): Record<string, string | undefined> => {
    // `refs` must be stable (memoized by the caller): a new array is a new lookup atom.
    const names = useMemo(
        () =>
            atom((get) =>
                Object.fromEntries(
                    refs.map((ref) => [ref, get(agentDisplayNameAtomFamily(ref))] as const),
                ),
            ),
        [refs],
    )
    return useAtomValue(names)
}
