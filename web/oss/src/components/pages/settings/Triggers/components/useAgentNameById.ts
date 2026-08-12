/** Agent id → display name, shared by the schedule + subscription settings tables. */
import {
    appWorkflowsListQueryStateAtom,
    workflowVariantsListDataAtomFamily,
} from "@agenta/entities/workflow"
import {atom, useAtomValue} from "jotai"

/**
 * Maps every id a trigger might be bound through to its agent's name.
 *
 * A trigger names its agent by artifact, variant, or revision, and `triggerBoundAgentId` returns
 * whichever the reference carries. UI-created triggers carry the artifact; agent/SDK-created ones
 * carry `workflow_variant`, whose id is NOT the artifact id — keyed by artifact alone, those rows
 * rendered "-".
 *
 * Names come from the applications list rather than `workflowMolecule.artifactName`: the molecule
 * is scoped to an open app, so on these settings pages its artifact query never resolves.
 */
const agentNameByIdAtom = atom((get) => {
    const byId = new Map<string, string>()
    get(appWorkflowsListQueryStateAtom).data.forEach((workflow) => {
        const id = workflow.id as string | undefined
        // Omit rather than store "": `?? "Unknown"` at a call site won't replace an empty string.
        const name = workflow.name?.trim() || workflow.slug?.trim()
        if (!id || !name) return
        byId.set(id, name)
        get(workflowVariantsListDataAtomFamily(id)).forEach((variant) => {
            if (variant.id) byId.set(variant.id, name)
        })
    })
    return byId
})

export function useAgentNameById(): Map<string, string> {
    return useAtomValue(agentNameByIdAtom)
}
