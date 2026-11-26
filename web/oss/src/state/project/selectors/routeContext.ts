import type {RouteLayer} from "@/oss/state/appState"

/** Terminal states of the route-level id guard, shaped like `CurrentWorkflowContext`. */
export interface RouteContext {
    isResolving: boolean
    isNotFound: boolean
    isError: boolean
    /**
     * The organization id to put in the `/w/<segment>` part instead of the URL's one: set when
     * the segment is a legacy workspace id of the project the URL names (workspace removal step
     * 2 answers the organization id where a workspace id was). The layout replaces the URL.
     */
    canonicalWorkspaceId?: string | null
}

export const NEUTRAL_ROUTE_CONTEXT: RouteContext = {
    isResolving: false,
    isNotFound: false,
    isError: false,
}

const RESOLVING: RouteContext = {isResolving: true, isNotFound: false, isError: false}
const NOT_FOUND: RouteContext = {isResolving: false, isNotFound: true, isError: false}
const ERRORED: RouteContext = {isResolving: false, isNotFound: false, isError: true}

/** The same address with `organizationId` in the `/w/<segment>` part; null when unchanged. */
export const canonicalWorkspacePath = (asPath: string, organizationId: string): string | null => {
    const match = /^\/w\/([^/?#]+)(.*)$/.exec(asPath)
    if (!match) return null
    if (decodeURIComponent(match[1]) === organizationId) return null
    return `/w/${encodeURIComponent(organizationId)}${match[2]}`
}

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
    /**
     * The organization of the project the URL names, when the account holds it. A legacy
     * workspace id in the URL is then rewritten to it instead of answering not found.
     */
    projectOrganizationId?: string | null
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
    projectOrganizationId,
}: RouteContextInput): RouteContext => {
    if (!shouldRunRouteGuard(routeLayer) || !workspaceId) return NEUTRAL_ROUTE_CONTEXT
    if (isPending) return RESOLVING
    if (failed) return ERRORED
    // A bookmark with a legacy workspace id for a project the account holds: rewrite it to the
    // project's organization id, the id every API pod answers, instead of a 404.
    if (projectId && !projectInWorkspace && projectOrganizationId) {
        return {...RESOLVING, canonicalWorkspaceId: projectOrganizationId}
    }
    if (!workspaceHoldsProject) return NOT_FOUND
    // A project that exists but sits in another workspace makes the pair in the URL wrong.
    if (projectId && !projectInWorkspace) return NOT_FOUND
    return NEUTRAL_ROUTE_CONTEXT
}
