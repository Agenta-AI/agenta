import {useRouter} from "next/router"

import {QueueSessionScreen} from "@/features/annotations/QueueSessionScreen"
import {DeveloperViewGate} from "@/features/developer/DeveloperViewGate"

// A run's queue opens wherever its run page opens.
const QUEUE_PAGE_VIEWS = ["annotation-queues", "evaluations"] as const

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
        <DeveloperViewGate viewId={QUEUE_PAGE_VIEWS}>
            <QueueSessionScreen workspaceId={workspaceId} projectId={projectId} queueId={queueId} />
        </DeveloperViewGate>
    )
}
