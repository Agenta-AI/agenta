import type {RouteLayer} from "@/oss/state/appState"

/** Terminal states of a workspace index gate, shaped like `CurrentWorkflowContext`. */
export interface WorkspaceContext {
    isResolving: boolean
    isNotFound: boolean
    isError: boolean
}

export const NEUTRAL_WORKSPACE_CONTEXT: WorkspaceContext = {
    isResolving: false,
    isNotFound: false,
    isError: false,
}

const RESOLVING: WorkspaceContext = {isResolving: true, isNotFound: false, isError: false}
const NOT_FOUND: WorkspaceContext = {isResolving: false, isNotFound: true, isError: false}
const ERRORED: WorkspaceContext = {isResolving: false, isNotFound: false, isError: true}

/** The workspace index gates own workspace-scoped routes only. */
export const shouldRunWorkspaceGuard = (routeLayer: RouteLayer): boolean =>
    routeLayer === "workspace"

export interface WorkspaceContextInput {
    routeLayer: RouteLayer
    workspaceId: string | null
    sessionExists: boolean
    /** The projects query before it settles. A disabled query counts as pending, which is right. */
    isPending: boolean
    /** How the projects query failed, or null when it succeeded. */
    failure: {status: number | null} | null
}

/**
 * Which state `/w/:workspace_id` and `/w/:workspace_id/p` are in.
 *
 * The auth middleware resolves `workspace_id` before the projects handler and answers 4xx when
 * no such workspace exists, so that status is the only thing separating a bad id from an empty
 * workspace. A failure carrying no status is the network, not the address.
 */
export const resolveWorkspaceContext = ({
    routeLayer,
    workspaceId,
    sessionExists,
    isPending,
    failure,
}: WorkspaceContextInput): WorkspaceContext => {
    if (!shouldRunWorkspaceGuard(routeLayer) || !workspaceId) return NEUTRAL_WORKSPACE_CONTEXT
    if (isPending) return RESOLVING
    if (!failure) return NEUTRAL_WORKSPACE_CONTEXT

    const {status} = failure
    if (status !== null && status >= 400 && status < 500) {
        // Without a live session the 401 is about the session, and ProtectedRoute owns that.
        return sessionExists ? NOT_FOUND : RESOLVING
    }

    return ERRORED
}
