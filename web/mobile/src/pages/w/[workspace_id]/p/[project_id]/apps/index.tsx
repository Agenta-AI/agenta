import {useRouter} from "next/router"

import {HomeScreen} from "@/features/home/HomeScreen"

export default function HomePage() {
    const router = useRouter()
    const workspaceId =
        typeof router.query.workspace_id === "string" ? router.query.workspace_id : ""
    const projectId = typeof router.query.project_id === "string" ? router.query.project_id : ""
    if (!workspaceId || !projectId) return null
    return <HomeScreen workspaceId={workspaceId} projectId={projectId} />
}
