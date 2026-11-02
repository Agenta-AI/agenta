import {useRouter} from "next/router"

import {ContextResolver} from "./ContextResolver"

/**
 * Body of the `/w/:workspace_id` and `/w/:workspace_id/p` index gates: resolve a project
 * INSIDE the workspace the URL names and forward to its home. The desktop's
 * `WorkspaceRedirect` / `WorkspaceProjectRedirect` twins — without them these paths 404,
 * which is what a shared link truncated at the workspace hits.
 */
export const WorkspaceContextRedirect = () => {
    const router = useRouter()
    const workspaceId =
        typeof router.query.workspace_id === "string" ? router.query.workspace_id : undefined
    return <ContextResolver workspaceId={workspaceId} />
}
