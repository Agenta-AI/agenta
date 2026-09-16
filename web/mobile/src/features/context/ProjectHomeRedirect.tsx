import {useEffect} from "react"

import {useRouter} from "next/router"

import {HomePageSkeleton} from "@/features/home/states/HomePageSkeleton"
import {projectHomeUrl} from "@/lib/context"

/**
 * Body of the `/w/:workspace_id/p/:project_id` index gate: the URL already names the pair, so
 * this only forwards to the project home. No fetch — an id we cannot route to is the home
 * screen's problem, not this gate's.
 */
export const ProjectHomeRedirect = () => {
    const router = useRouter()
    const workspaceId =
        typeof router.query.workspace_id === "string" ? router.query.workspace_id : ""
    const projectId = typeof router.query.project_id === "string" ? router.query.project_id : ""

    useEffect(() => {
        if (!router.isReady || !workspaceId || !projectId) return
        void router.replace(projectHomeUrl({workspaceId, projectId}))
    }, [router.isReady, workspaceId, projectId])

    // The destination's own skeleton, so the forward is one continuous hold rather than a line
    // of text that the home skeleton then replaces.
    return <HomePageSkeleton />
}
