import {useEffect, useRef} from "react"

import {message} from "@agenta/ui/app-message"
import {useAtomValue} from "jotai"
import {useRouter} from "next/router"

import {appIdentifiersAtom} from "@/oss/state/appState"

import {
    resolveWorkflowDestination,
    type WorkflowKind,
    type WorkflowRouteSegment,
} from "../destinations"
import {currentWorkflowContextAtom, type CurrentWorkflowContext} from "../selectors/workflow"

interface UseWorkflowRouteGuardOptions {
    /**
     * Override for the destination when role flag is missing entirely
     * (workflowKind === null). Defaults to apps listing.
     */
    unknownKindFallback?: string
}

/**
 * Guards a route on workflow kind. Toasts + redirects when the current
 * workflow's kind is not in `allowed`. Waits on query resolution. Renders
 * (lets the page show its own loading/not-found UI) when not ready.
 *
 * Returns the live context so the caller can render terminal-state UI
 * (skeleton on resolving, not-found component on isNotFound, error fallback
 * on isError).
 *
 * Toast is unconditional when the guard fires. Every fire represents a
 * meaningful redirect the user should be told about. There is no
 * "suppress on initial mount" rule (would contradict the bookmark case).
 */
export const useWorkflowRouteGuard = (
    allowed: readonly WorkflowKind[],
    currentRoute: WorkflowRouteSegment,
    options: UseWorkflowRouteGuardOptions = {},
): CurrentWorkflowContext => {
    const ctx = useAtomValue(currentWorkflowContextAtom)
    const {workspaceId, projectId} = useAtomValue(appIdentifiersAtom)
    const router = useRouter()

    // Track which workflow ID we've already fired a guard redirect for, to
    // avoid double-firing if the effect re-runs after the redirect started
    // (e.g., underlying query refetches between navigation start and
    // commit).
    const redirectedFor = useRef<string | null>(null)

    useEffect(() => {
        if (ctx.isResolving) return // wait for queries to settle
        if (ctx.isError) return // page renders error fallback; do not redirect on error
        if (ctx.isNotFound) return // <WorkflowNotFound /> renders below

        if (redirectedFor.current && redirectedFor.current === ctx.workflowId) {
            return
        }

        const fallback =
            options.unknownKindFallback ??
            (workspaceId && projectId
                ? `/w/${encodeURIComponent(workspaceId)}/p/${encodeURIComponent(projectId)}/apps`
                : "/apps")

        if (!ctx.workflowKind) {
            redirectedFor.current = ctx.workflowId
            router.replace(fallback)
            return
        }

        if (allowed.includes(ctx.workflowKind)) return

        // Disallowed kind for this route — toast + redirect via single source of truth.
        if (!workspaceId || !projectId || !ctx.workflowId) {
            // Defensive: identifiers should always exist when we get here, but
            // if they don't, fall back to the apps listing.
            redirectedFor.current = ctx.workflowId
            router.replace(fallback)
            return
        }

        const target = resolveWorkflowDestination({
            kind: ctx.workflowKind,
            currentRoute,
            workflowId: ctx.workflowId,
            workspaceId,
            projectId,
        })

        // Dev-mode signal so Phase 4 sidebar leaks (a disabled menu item leaking
        // for an evaluator) are visible to engineers via the browser console.
        // OSS doesn't currently use Sentry; if added later, swap for
        // Sentry.addBreadcrumb({category: "workflow.guard", ...}).
        if (process.env.NODE_ENV !== "production") {
            console.warn(
                `[workflow-guard] redirect: kind=${ctx.workflowKind} route=${currentRoute} → ${target}`,
            )
        }

        message.info("This view isn't available for this workflow type.")
        redirectedFor.current = ctx.workflowId
        router.replace(target)
    }, [
        ctx.isResolving,
        ctx.isError,
        ctx.isNotFound,
        ctx.workflowKind,
        ctx.workflowId,
        currentRoute,
        workspaceId,
        projectId,
        // `allowed` is intentionally omitted from deps — callers pass an inline
        // array literal which would cause the effect to re-run every render.
        // Treat `allowed` as static per route mount.
    ])

    // Reset the dedup ref if the workflow ID changes underneath us (e.g., user
    // navigates from one workflow to another while on the same route).
    useEffect(() => {
        if (redirectedFor.current && redirectedFor.current !== ctx.workflowId) {
            redirectedFor.current = null
        }
    }, [ctx.workflowId])

    return ctx
}
