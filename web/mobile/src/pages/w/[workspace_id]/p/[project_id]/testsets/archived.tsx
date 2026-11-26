import {useRouter} from "next/router"

import {DeveloperViewGate} from "@/features/developer/DeveloperViewGate"
import {ArchivedTestsetsScreen} from "@/features/testsets/archived/ArchivedTestsetsScreen"

export default function ArchivedTestsetsPage() {
    const router = useRouter()
    const {workspace_id: workspaceId, project_id: projectId} = router.query
    if (typeof workspaceId !== "string" || typeof projectId !== "string") return null
    return (
        <DeveloperViewGate viewId="testsets">
            <ArchivedTestsetsScreen workspaceId={workspaceId} projectId={projectId} />
        </DeveloperViewGate>
    )
}
