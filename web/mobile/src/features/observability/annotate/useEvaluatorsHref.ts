import {useRouter} from "next/router"

import {useDeveloperViewEnabled} from "@/features/developer/developerViewAccess"
import {evaluatorsUrl} from "@/features/evaluators/evaluatorPaths"

/** The human evaluators page of this project, when the evaluators view is on; else null. */
export const useEvaluatorsHref = (): string | null => {
    const {query} = useRouter()
    const enabled = useDeveloperViewEnabled("evaluators") === true
    const workspaceId = query.workspace_id
    const projectId = query.project_id
    if (!enabled || typeof workspaceId !== "string" || typeof projectId !== "string") return null
    return evaluatorsUrl(workspaceId, projectId, "human")
}
