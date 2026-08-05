import {useRouter} from "next/router"

import {SessionListScreen} from "@/features/sessions/SessionListScreen"

export default function SessionsPage() {
    const router = useRouter()
    const {workspace_id: workspaceId, project_id: projectId} = router.query
    if (typeof workspaceId !== "string" || typeof projectId !== "string") return null
    return <SessionListScreen workspaceId={workspaceId} projectId={projectId} />
}
