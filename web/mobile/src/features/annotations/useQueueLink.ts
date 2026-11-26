import {useCallback} from "react"

import {useRouter} from "next/router"

/**
 * The toast link to one queue. The Next router adds the /m base path; a raw location match would
 * not. Without a workspace and project in the route there is no link.
 */
export const useQueueLink = () => {
    const router = useRouter()
    const workspaceId = router.query.workspace_id
    const projectId = router.query.project_id
    const base =
        typeof workspaceId === "string" && typeof projectId === "string"
            ? `/w/${workspaceId}/p/${projectId}`
            : null

    return useCallback(
        (queueId: string, linkText: string) => ({
            onNavigate: base ? () => void router.push(`${base}/annotations/${queueId}`) : undefined,
            linkText,
        }),
        [base, router],
    )
}
