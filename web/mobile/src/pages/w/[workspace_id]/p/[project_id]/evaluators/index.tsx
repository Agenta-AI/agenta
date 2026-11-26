import {useRouter} from "next/router"

import {DeveloperViewGate} from "@/features/developer/DeveloperViewGate"
import {EvaluatorsScreen} from "@/features/evaluators/EvaluatorsScreen"

export default function EvaluatorsPage() {
    const router = useRouter()
    const workspaceId =
        typeof router.query.workspace_id === "string" ? router.query.workspace_id : ""
    const projectId = typeof router.query.project_id === "string" ? router.query.project_id : ""
    if (!workspaceId || !projectId) return null
    return (
        <DeveloperViewGate viewId="evaluators">
            <EvaluatorsScreen workspaceId={workspaceId} projectId={projectId} />
        </DeveloperViewGate>
    )
}
