import type {RouteLayer} from "@/oss/state/appState"

/** Terminal states of the route-level id guard, shaped like `CurrentWorkflowContext`. */
export interface RouteContext {
    isResolving: boolean
    isNotFound: boolean
    isError: boolean
}

export const NEUTRAL_ROUTE_CONTEXT: RouteContext = {
    isResolving: false,
    isNotFound: false,
    isError: false,
}

const RESOLVING: RouteContext = {isResolving: true, isNotFound: false, isError: false}
const NOT_FOUND: RouteContext = {isResolving: false, isNotFound: true, isError: false}
const ERRORED: RouteContext = {isResolving: false, isNotFound: false, isError: true}

/** `/w/:workspace_id` and `/p/:project_id` gate every route under them, so the guard owns all three. */
export const shouldRunRouteGuard = (routeLayer: RouteLayer): boolean =>
    routeLayer === "workspace" || routeLayer === "project" || routeLayer === "app"

export interface RouteContextInput {
    routeLayer: RouteLayer
    workspaceId: string | null
    /** Null on `/w/:id`, which names no project. */
    projectId: string | null
    /** The guard query before it settles. A disabled query counts as pending, which is right. */
    isPending: boolean
    /** The guard query settled with an error, which says nothing about the address. */
    failed: boolean
    /** The account holds some project in the workspace the URL names. */
    workspaceHoldsProject: boolean
    /** The project the URL names is in the workspace the URL names. */
    projectInWorkspace: boolean
}

/**
 * Whether the ids in the address resolve.
 *
 * Membership, not a status code: the workspace-scoped projects request 401s for an id that does
 * not exist and then never settles, so only the unscoped list can answer. Both ids come from that
 * one response. A guard query that failed outright must never reach the 404.
 */
export const resolveRouteContext = ({
    routeLayer,
    workspaceId,
    projectId,
    isPending,
    failed,
    workspaceHoldsProject,
    projectInWorkspace,
}: RouteContextInput): RouteContext => {
    if (!shouldRunRouteGuard(routeLayer) || !workspaceId) return NEUTRAL_ROUTE_CONTEXT
    if (isPending) return RESOLVING
    if (failed) return ERRORED
    if (!workspaceHoldsProject) return NOT_FOUND
    // A project that exists but sits in another workspace makes the pair in the URL wrong.
    if (projectId && !projectInWorkspace) return NOT_FOUND
    return NEUTRAL_ROUTE_CONTEXT
}
