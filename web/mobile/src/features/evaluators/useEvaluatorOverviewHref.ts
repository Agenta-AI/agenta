import {developerModeActiveAtom} from "@agenta/shared/state"
import {useAtomValue} from "jotai"
import {useRouter} from "next/router"

/**
 * The evaluator's own Overview page, or null outside Developer Mode: the
 * evaluator pages exist only there.
 */
export const useEvaluatorOverviewHref = (workflowId: string): string | null => {
    const {query} = useRouter()
    const beta = useAtomValue(developerModeActiveAtom)
    const workspaceId = typeof query.workspace_id === "string" ? query.workspace_id : null
    const projectId = typeof query.project_id === "string" ? query.project_id : null
    if (!beta || !workspaceId || !projectId) return null
    return `/w/${workspaceId}/p/${projectId}/apps/${workflowId}/overview`
}
