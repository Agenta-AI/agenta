/**
 * Soft default for the `trace_type` filter on the app-scoped observability
 * page (`/apps/<entityId>/traces`).
 *
 * Lives in entities (not in OSS) so the truth table can be unit-tested with
 * vitest. The OSS atom in `state/newObservability/atoms/controls.ts` calls
 * this helper and applies the result as a filter when no user override is
 * present.
 *
 * - `tab === "sessions"` → no default (Sessions tab is app-only; evaluators
 *   don't emit them — the tab itself is hidden for evaluator workflows per
 *   Phase 6.3.3, but a stale `?tab=sessions` URL still hits this code).
 * - `workflowKind === "evaluator"` → `"annotation"`. Production evaluators
 *   score app traces and emit annotation-type traces. The playground-
 *   triggered standalone evaluator runs (which emit invocation traces with
 *   `references.application` set) are the edge case, not the default.
 * - everything else (`"app"`, `"snippet"`, `null`) → `"invocation"`. Apps
 *   invoke models; the app-scoped observability page should default to
 *   those.
 *
 * Returns `null` when no soft default should apply.
 */
export type TraceTypeDefault = "invocation" | "annotation"
export type ObservabilityTab = "traces" | "sessions"

/**
 * Workflow role kind, mirrored locally to keep this helper free of OSS
 * imports. OSS' canonical type lives at
 * `web/oss/src/state/workflow/destinations.ts:11` with the same shape; the
 * compiler will catch any drift at the wire-up site in `controls.ts`.
 */
export type WorkflowKindForTraceDefault = "app" | "evaluator" | "snippet"

export function defaultTraceTypeForWorkflow(
    workflowKind: WorkflowKindForTraceDefault | null,
    tab: ObservabilityTab,
): TraceTypeDefault | null {
    if (tab !== "traces") return null
    if (workflowKind === "evaluator") return "annotation"
    return "invocation"
}
