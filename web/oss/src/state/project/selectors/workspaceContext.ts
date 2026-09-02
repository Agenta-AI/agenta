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
    /** The guard query before it settles. A disabled query counts as pending, which is right. */
    isPending: boolean
    /** The guard query settled with an error — the network, not the address. */
    failed: boolean
    /** Some project in the account's list sits in the workspace the URL names. */
    belongsToWorkspace: boolean
}

/**
 * Which state `/w/:workspace_id` and `/w/:workspace_id/p` are in.
 *
 * Membership, not a status code: the workspace-scoped projects request 401s for an id that does
 * not exist and then never settles, so only the unscoped list can answer. A guard query that
 * failed outright says nothing about the address and must never reach the 404.
 */
export const resolveWorkspaceContext = ({
    routeLayer,
    workspaceId,
    isPending,
    failed,
    belongsToWorkspace,
}: WorkspaceContextInput): WorkspaceContext => {
    if (!shouldRunWorkspaceGuard(routeLayer) || !workspaceId) return NEUTRAL_WORKSPACE_CONTEXT
    if (isPending) return RESOLVING
    if (failed) return ERRORED
    return belongsToWorkspace ? NEUTRAL_WORKSPACE_CONTEXT : NOT_FOUND
}
