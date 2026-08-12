/** Agent id → display name, shared by the schedule + subscription settings tables. */
import {useMemo} from "react"

import {appWorkflowsListQueryStateAtom} from "@agenta/entities/workflow"
import {useAtomValue} from "jotai"

/**
 * Agent names come from the applications list, not `workflowMolecule.artifactName`: the molecule
 * is scoped to an open app, so on these settings pages its artifact query never resolves.
 */
export function useAgentNameById(): Map<string, string> {
    const workflows = useAtomValue(appWorkflowsListQueryStateAtom)
    return useMemo(() => {
        const byId = new Map<string, string>()
        workflows.data.forEach((w) => {
            const id = w.id as string | undefined
            if (id) byId.set(id, w.name?.trim() || w.slug?.trim() || "")
        })
        return byId
    }, [workflows.data])
}
