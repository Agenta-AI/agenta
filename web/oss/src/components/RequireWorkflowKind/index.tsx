import {type ReactNode} from "react"

import {Spin} from "antd"

import WorkflowNotFound from "@/oss/components/WorkflowNotFound"
import {
    useWorkflowRouteGuard,
    type WorkflowKind,
    type WorkflowRouteSegment,
} from "@/oss/state/workflow"

interface RequireWorkflowKindProps {
    /** Allowed workflow kinds for this route. */
    allowed: readonly WorkflowKind[]
    /** Sub-route segment label — used by the destination resolver and telemetry. */
    currentRoute: WorkflowRouteSegment
    /** Element to render while queries are still resolving. Defaults to a centered spinner. */
    fallback?: ReactNode
    /** Element to render if BOTH underlying queries error. Defaults to children (over-render). */
    errorFallback?: ReactNode
    /** The page contents to render when the workflow loads and is allowed on this route. */
    children: ReactNode
}

/**
 * Page-level wrapper that gates a sub-route on workflow kind.
 *
 * Renders three distinct UI states based on the guard hook's terminal context:
 *  1. `isResolving` → fallback (spinner)
 *  2. `isNotFound` → `<WorkflowNotFound />`
 *  3. `isError` → errorFallback (defaults to children — over-render is safer than wrong-redirect)
 *  4. Workflow loaded + kind allowed → children
 *  5. Workflow loaded + kind disallowed → null (guard hook fires `router.replace` + toast)
 */
function RequireWorkflowKind({
    allowed,
    currentRoute,
    fallback,
    errorFallback,
    children,
}: RequireWorkflowKindProps) {
    const ctx = useWorkflowRouteGuard(allowed, currentRoute)

    if (ctx.isResolving) {
        return (
            (fallback as JSX.Element | null) ?? (
                <div className="flex items-center justify-center w-full h-full min-h-[240px]">
                    <Spin />
                </div>
            )
        )
    }

    if (ctx.isNotFound) {
        return <WorkflowNotFound workflowId={ctx.workflowId} routeSegment={currentRoute} />
    }

    if (ctx.isError) {
        // Over-render rather than wrong-redirect. If both underlying queries are
        // in error state, let the page try to render — its own data atoms will
        // probably fail loudly, which is fine. Caller may pass `errorFallback`
        // to override.
        return (errorFallback as JSX.Element | null) ?? <>{children}</>
    }

    if (!ctx.workflowKind) {
        // Workflow has no role flag set. Guard hook redirected to apps listing.
        return null
    }

    if (!allowed.includes(ctx.workflowKind)) {
        // Disallowed kind. Guard hook redirected via resolveWorkflowDestination.
        return null
    }

    return <>{children}</>
}

export default RequireWorkflowKind
