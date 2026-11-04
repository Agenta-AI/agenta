import {useRouter} from "next/router"

import {DeveloperViewGate} from "@/features/developer/DeveloperViewGate"
import {TestsetDetailScreen} from "@/features/testsets/detail/TestsetDetailScreen"

export default function TestsetDetailPage() {
    const router = useRouter()
    const {
        workspace_id: workspaceId,
        project_id: projectId,
        testset_id: testsetId,
        name,
    } = router.query
    if (
        typeof workspaceId !== "string" ||
        typeof projectId !== "string" ||
        typeof testsetId !== "string"
    ) {
        return null
    }
    return (
        <DeveloperViewGate viewId="testsets">
            <TestsetDetailScreen
                // A new page per revision: the editor state belongs to one revision.
                key={testsetId}
                workspaceId={workspaceId}
                projectId={projectId}
                routeId={testsetId}
                nameFromUrl={typeof name === "string" ? name : null}
            />
        </DeveloperViewGate>
    )
}
