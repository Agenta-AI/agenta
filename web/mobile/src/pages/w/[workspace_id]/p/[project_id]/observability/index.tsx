import {useRouter} from "next/router"

import {ObservabilityScreen} from "@/features/observability/ObservabilityScreen"

export default function ObservabilityPage() {
    const router = useRouter()
    const {workspace_id: workspaceId, project_id: projectId} = router.query
    if (typeof workspaceId !== "string" || typeof projectId !== "string") return null
    return <ObservabilityScreen workspaceId={workspaceId} projectId={projectId} />
}
