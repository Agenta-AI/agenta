import {useRouter} from "next/router"

import {HomeScreen} from "@/features/home/HomeScreen"
import {HomePageSkeleton} from "@/features/home/states/HomePageSkeleton"

export default function HomePage() {
    const router = useRouter()
    const workspaceId =
        typeof router.query.workspace_id === "string" ? router.query.workspace_id : ""
    const projectId = typeof router.query.project_id === "string" ? router.query.project_id : ""
    // `router.query` is empty on the first render of a hard load, so this branch is the page's
    // real loading state rather than an impossible case — returning null opened it as a blank
    // screen that then snapped into the page.
    if (!workspaceId || !projectId) return <HomePageSkeleton />
    return <HomeScreen workspaceId={workspaceId} projectId={projectId} />
}
