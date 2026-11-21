import {useMemo} from "react"

import {
    retrievedWorkflowRevisionFamilyKey,
    retrievedWorkflowRevisionQueryAtomFamily,
    workflowArtifactQueryAtomFamily,
} from "@agenta/entities/workflow"
import {useAtomValue} from "jotai"

const UUID_SHAPED = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * The name of the agent that a tool call names by its slug or id (`start_session`), as the agent
 * lists show it. Undefined until it loads. When the agent cannot be found, a slug stands in for
 * the name; an id never does.
 */
export const useAgentDisplayName = (ref: string | undefined): string | undefined => {
    const isId = !!ref && UUID_SHAPED.test(ref)
    const key = useMemo(
        () =>
            retrievedWorkflowRevisionFamilyKey(
                ref ? {workflow: isId ? {id: ref} : {slug: ref}} : null,
            ),
        [ref, isId],
    )
    const revision = useAtomValue(retrievedWorkflowRevisionQueryAtomFamily(key))
    const workflowId = revision.data?.workflowId ?? ""
    const agent = useAtomValue(workflowArtifactQueryAtomFamily(workflowId))
    const name = (workflowId && (agent.data?.name?.trim() || agent.data?.slug?.trim())) || undefined
    if (name) return name
    const notFound = revision.isError || (revision.isSuccess && !workflowId) || agent.isError
    return ref && !isId && notFound ? ref : undefined
}
