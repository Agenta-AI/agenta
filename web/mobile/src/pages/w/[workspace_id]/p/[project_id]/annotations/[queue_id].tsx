import {useRouter} from "next/router"

import {QueueSessionScreen} from "@/features/annotations/QueueSessionScreen"
import {DeveloperViewGate} from "@/features/developer/DeveloperViewGate"

export default function AnnotationQueuePage() {
    const router = useRouter()
    const {workspace_id: workspaceId, project_id: projectId, queue_id: queueId} = router.query
    if (
        typeof workspaceId !== "string" ||
        typeof projectId !== "string" ||
        typeof queueId !== "string"
    ) {
        return null
    }
    return (
        <DeveloperViewGate viewId="annotation-queues">
            <QueueSessionScreen workspaceId={workspaceId} projectId={projectId} queueId={queueId} />
        </DeveloperViewGate>
    )
}
