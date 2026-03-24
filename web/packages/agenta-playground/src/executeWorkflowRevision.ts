/**
 * executeWorkflowRevision
 *
 * Standalone imperative function that runs a single workflow revision against
 * a given input data object using the full playground execution infrastructure
 * (concurrency limiting, abort, chain execution, URL/payload resolution via
 * workflowMolecule).
 *
 * Unlike the playground's interactive execution path, this function:
 * - Does NOT require a React context or any playground UI atoms
 * - Creates a transient synthetic loadable row for the duration of the call
 * - Cleans up all transient state after the call completes
 * - Returns a plain promise with the result
 *
 * Usage (from an evaluation context):
 *
 * ```typescript
 * import { executeWorkflowRevision } from '@agenta/playground'
 * import { workflowMolecule } from '@agenta/entities/workflow'
 *
 * // Pre-seed the fetched workflow into the default store
 * workflowMolecule.set.seedEntity(revisionId, fetchedWorkflow)
 *
 * const result = await executeWorkflowRevision({
 *   revisionId,
 *   inputData: { country: "France", city: "Paris" },
 *   projectId,
 * })
 * // result: { status, output, traceId, spanId, error }
 * ```
 */

import {loadableController} from "@agenta/entities/runnable"
import type {PlaygroundNode} from "@agenta/entities/runnable"
import {testcaseMolecule} from "@agenta/entities/testcase"
import {getDefaultStore} from "jotai/vanilla"

import {executeStepForSessionWithExecutionItems} from "./state/execution/executionRunner"
import type {ExecutionSession} from "./state/execution/types"

// ============================================================================
// TYPES
// ============================================================================

export interface ExecuteWorkflowRevisionParams {
    /** The workflow revision ID (must already be seeded via workflowMolecule.set.seedEntity) */
    revisionId: string
    /** Input data to pass to the workflow (key-value map) */
    inputData: Record<string, unknown>
    /** Project ID scoped to the execution */
    projectId?: string | null
    /** Optional auth headers to forward (e.g. Authorization) */
    headers?: Record<string, string>
    /** Abort signal to cancel the execution */
    abortSignal?: AbortSignal
}

export interface ExecuteWorkflowRevisionResult {
    status: "success" | "error" | "cancelled"
    output?: unknown
    structuredOutput?: unknown
    traceId?: string | null
    spanId?: string | null
    error?: {message: string; code?: string}
}

// ============================================================================
// IMPLEMENTATION
// ============================================================================

/**
 * Execute a single workflow revision against input data.
 *
 * Requires the revision to be pre-seeded into the default Jotai store via:
 *   workflowMolecule.set.seedEntity(revisionId, fetchedWorkflow)
 *
 * This ensures workflowMolecule selectors (invocationUrl, requestPayload, etc.)
 * resolve correctly without needing a React context or query subscription.
 */
export async function executeWorkflowRevision(
    params: ExecuteWorkflowRevisionParams,
): Promise<ExecuteWorkflowRevisionResult> {
    const {revisionId, inputData, projectId, headers = {}} = params

    const store = getDefaultStore()

    // Create a unique transient loadable ID so this call doesn't interfere with
    // any existing playground loadable state.
    const loadableId = `eval-invocation:${revisionId}:${Date.now()}`
    const stepId = `step-${Date.now()}`

    // Add a synthetic testcase row to the loadable so that
    // createExecutionItemHandle can resolve displayRowIds and row data.
    // We pass inputData so that variable resolution works as a fallback,
    // even though the runner will use inputValues directly.
    const rowId: string | null = store.set(loadableController.actions.addRow, loadableId, inputData)

    if (!rowId) {
        return {
            status: "error",
            error: {message: "Failed to create synthetic testcase row for execution"},
        }
    }

    // Build a minimal single-node topology (no chain, depth=0)
    const node: PlaygroundNode = {
        id: `node-${revisionId}`,
        entityId: revisionId,
        entityType: "workflow",
        depth: 0,
    }

    const session: ExecutionSession = {
        id: `sess:${revisionId}`,
        runnableId: revisionId,
        runnableType: "workflow",
        mode: "completion",
    }

    return new Promise<ExecuteWorkflowRevisionResult>((resolve) => {
        executeStepForSessionWithExecutionItems({
            get: store.get,
            set: store.set,
            loadableId,
            stepId,
            session,
            data: inputData,
            nodes: [node],
            allConnections: [],
            sessionOptions: {
                [session.id]: {
                    ...(projectId ? {projectId} : {}),
                    headers,
                },
            },
            lifecycle: {
                onStart: () => {
                    // nothing to do — no progress tracking needed here
                },
                onProgress: () => {
                    // nothing to do
                },
                onComplete: ({result}) => {
                    cleanup()
                    resolve({
                        status: "success",
                        output: result.output,
                        structuredOutput: result.structuredOutput,
                        traceId: result.traceId ?? null,
                        spanId: extractSpanId(result),
                        error: undefined,
                    })
                },
                onFail: ({error, traceId}) => {
                    cleanup()
                    resolve({
                        status: "error",
                        traceId: traceId ?? null,
                        error: error ?? {message: "Execution failed"},
                    })
                },
                onCancel: () => {
                    cleanup()
                    resolve({status: "cancelled"})
                },
            },
        })
    })

    function cleanup() {
        // Delete the transient testcase entity to avoid memory leaks
        store.set(testcaseMolecule.actions.delete, rowId as string)
    }
}

/**
 * Try to extract a span ID from the structured execution result.
 * The span_id may appear in different locations depending on the workflow type.
 */
function extractSpanId(result: Partial<{structuredOutput?: unknown}>): string | null {
    const s = result.structuredOutput as Record<string, unknown> | null | undefined
    if (!s) return null
    const spanId = s.span_id ?? s.spanId ?? (s.tree as Record<string, unknown> | undefined)?.span_id
    return typeof spanId === "string" ? spanId : null
}
