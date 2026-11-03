import {useRouter} from "next/router"

import {SessionListScreen} from "@/features/sessions/SessionListScreen"
import {SessionsPageSkeleton} from "@/features/sessions/states/SessionsPageSkeleton"

export default function SessionsPage() {
    const router = useRouter()
    const {workspace_id: workspaceId, project_id: projectId} = router.query
    // `router.query` is empty on the first render of a hard load, so this branch is the page's
    // real loading state rather than an impossible case — returning null opened it as a blank
    // screen that then snapped into a full list.
    if (typeof workspaceId !== "string" || typeof projectId !== "string")
        return <SessionsPageSkeleton />
    return <SessionListScreen workspaceId={workspaceId} projectId={projectId} />
}
