/**
 * Single source of truth for redirect destinations when a workflow kind is
 * disallowed on a given route.
 *
 * Replaces per-route `redirectTarget` functions (which would ping-pong for
 * snippets: disabled-route → playground → `/apps`, two toasts). The helper
 * gives every kind one canonical destination per route — single fire, single
 * toast.
 */

export type WorkflowKind = "app" | "evaluator" | "snippet"

export type WorkflowRouteSegment =
    | "overview"
    | "endpoints"
    | "evaluations"
    | "deployments"
    | "playground"
    | "variants"
    | "traces"

const DISABLED_FOR_EVALUATOR: ReadonlySet<WorkflowRouteSegment> = new Set([
    "overview",
    "endpoints",
    "evaluations",
    "deployments",
])

export interface ResolveWorkflowDestinationArgs {
    kind: WorkflowKind
    currentRoute: WorkflowRouteSegment
    workflowId: string
    workspaceId: string
    projectId: string
}

export function resolveWorkflowDestination({
    kind,
    currentRoute,
    workflowId,
    workspaceId,
    projectId,
}: ResolveWorkflowDestinationArgs): string {
    const base = `/w/${encodeURIComponent(workspaceId)}/p/${encodeURIComponent(projectId)}`
    const appsListing = `${base}/apps`

    // Snippets are not allowed on any /apps/[id]/* route — go to apps listing.
    if (kind === "snippet") return appsListing

    // Evaluators on a disabled route → land on this evaluator's playground.
    if (kind === "evaluator" && DISABLED_FOR_EVALUATOR.has(currentRoute)) {
        return `${base}/apps/${encodeURIComponent(workflowId)}/playground`
    }

    // Apps are allowed on every route in the design — no app should ever hit
    // a "disallowed kind" branch in practice. Fallback: apps listing.
    return appsListing
}
