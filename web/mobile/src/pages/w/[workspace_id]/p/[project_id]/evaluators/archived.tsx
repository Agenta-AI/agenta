import {useRouter} from "next/router"

import {DeveloperViewGate} from "@/features/developer/DeveloperViewGate"
import {ArchivedEvaluatorsScreen} from "@/features/evaluators/ArchivedEvaluatorsScreen"

export default function ArchivedEvaluatorsPage() {
    const router = useRouter()
    const workspaceId =
        typeof router.query.workspace_id === "string" ? router.query.workspace_id : ""
    const projectId = typeof router.query.project_id === "string" ? router.query.project_id : ""
    if (!workspaceId || !projectId) return null
    return (
        <DeveloperViewGate viewId="evaluators">
            <ArchivedEvaluatorsScreen workspaceId={workspaceId} projectId={projectId} />
        </DeveloperViewGate>
    )
}
