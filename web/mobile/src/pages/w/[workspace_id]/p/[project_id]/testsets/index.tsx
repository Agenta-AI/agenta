import {useRouter} from "next/router"

import {DeveloperViewGate} from "@/features/developer/DeveloperViewGate"
import {TestsetsListScreen} from "@/features/testsets/list/TestsetsListScreen"

export default function TestsetsPage() {
    const router = useRouter()
    const {workspace_id: workspaceId, project_id: projectId} = router.query
    if (typeof workspaceId !== "string" || typeof projectId !== "string") return null
    return (
        <DeveloperViewGate viewId="testsets">
            <TestsetsListScreen workspaceId={workspaceId} projectId={projectId} />
        </DeveloperViewGate>
    )
}
