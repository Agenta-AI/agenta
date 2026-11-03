import {useRouter} from "next/router"

import {QueueListScreen} from "@/features/annotations/QueueListScreen"
import {DeveloperViewGate} from "@/features/developer/DeveloperViewGate"

export default function AnnotationQueuesPage() {
    const router = useRouter()
    const workspaceId =
        typeof router.query.workspace_id === "string" ? router.query.workspace_id : ""
    const projectId = typeof router.query.project_id === "string" ? router.query.project_id : ""
    if (!workspaceId || !projectId) return null
    return (
        <DeveloperViewGate viewId="annotation-queues">
            <QueueListScreen workspaceId={workspaceId} projectId={projectId} />
        </DeveloperViewGate>
    )
}
