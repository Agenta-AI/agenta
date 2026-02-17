/**
 * Execution Integration
 *
 * Orchestrates playground execution:
 * - Builds payloads from entity/playground state
 * - Dispatches execution via direct fetch (single-node and chain)
 * - Processes results back into chat turns and execution state
 *
 * @module execution/webWorkerIntegration
 */

import {loadableController, type RunnableType} from "@agenta/entities/runnable"
import {isPlainObject} from "@agenta/shared/utils"
import {atom} from "jotai"
import {queryClientAtom} from "jotai-tanstack-query"

import {outputConnectionsAtom} from "../atoms/connections"
import {entityIdsAtom, playgroundNodesAtom} from "../atoms/playground"
import {clearSessionResponsesAtom} from "../chat"

import {handleExecutionResultAtom} from "./executionItems"
import {executeStepForSessionWithExecutionItems} from "./executionRunner"
import {
    startRunAtom,
    failRunAtom,
    cancelRunAtom,
    completeRunAtom,
    updateChainProgressAtom,
} from "./reducer"
import {derivedLoadableIdAtom, isChatModeAtom} from "./selectors"

// ============================================================================
// INJECTABLE AUTH HEADERS
// ============================================================================

/**
 * Injectable function that returns auth headers for worker HTTP requests.
 *
 * OSS sets this once in OSSPlaygroundEntityProvider.tsx with a function
 * that calls `getJWT()` and returns `{Authorization: \`Bearer ${jwt}\`}`.
 *
 * @example
 * ```ts
 * import { getJWT } from "@/oss/services/api"
 * store.set(executionHeadersAtom, async () => {
 *     const jwt = await getJWT()
 *     return jwt ? { Authorization: `Bearer ${jwt}` } : {}
 * })
 * ```
 */
export const executionHeadersAtom = atom<(() => Promise<Record<string, string>>) | null>(null)

interface ExecutionWorkerBridge {
    postMessageToWorker: (message: unknown) => void
    createWorkerMessage: (type: string, payload: unknown) => unknown
}

export interface ExecutionItemStepPayload {
    id: string
    messageId?: string
}

export interface TriggerExecutionItemPayload {
    executionId?: string
    step: ExecutionItemStepPayload
    /** When set, only execute this specific chain node instead of the full chain */
    targetNodeId?: string
}

/**
 * Injectable worker bridge used by execution atoms.
 *
 * OSS/EE should set this at app init via provider code.
 */
export const executionWorkerBridgeAtom = atom<ExecutionWorkerBridge | null>(null)

// ============================================================================
// PENDING REQUESTS & IGNORED RUNS
// ============================================================================

/**
 * Tracks pending web worker requests.
 * Keyed by runId → metadata about the request for result handling.
 */
export const pendingWebWorkerRequestsAtom = atom<
    Record<
        string,
        {
            rowId: string
            entityId: string
            runId: string
            timestamp: number
        }
    >
>({})

/**
 * Run IDs that should be ignored when results arrive (cancelled runs).
 */
export const ignoredWebWorkerRunIdsAtom = atom<Record<string, true>>({})

// ============================================================================
// TRIGGER ATOM
// ============================================================================

/**
 * Trigger execution for an execution item.
 *
 * Payload shape: `{ executionId, step: { id, messageId? }, targetNodeId? }`.
 *
 * This is the main entry point for running an entity from the playground.
 * Builds the payload from entity/playground state and dispatches execution
 * via direct fetch. Supports both full-chain and single-step execution.
 *
 * - When `targetNodeId` is omitted, the full chain executes (all stages).
 * - When `targetNodeId` is set, only that specific stage executes.
 */
export const triggerExecutionAtom = atom(
    null,
    async (get, set, params: TriggerExecutionItemPayload) => {
        const rowId = params.step.id
        const requestedRevisionId = params.executionId

        const entityIds = (get(entityIdsAtom) || []) as string[]
        const effectiveId = requestedRevisionId || entityIds[0] || null
        if (!effectiveId) return

        // Multi-entity fan-out: when no specific revision is requested and
        // multiple entities are shown side-by-side, trigger each one.
        if (!requestedRevisionId && Array.isArray(entityIds) && entityIds.length > 1) {
            const sessionMatch = /^turn-([^-]+)-(lt-.+)$/.exec(String(rowId))
            const logicalIdFromRow =
                sessionMatch?.[2] || (String(rowId).startsWith("lt-") ? String(rowId) : "")
            const lid = logicalIdFromRow || String(rowId)
            for (const revId of entityIds) {
                if (!revId) continue
                const rid = `turn-${revId}-${lid}`
                set(triggerExecutionAtom, {
                    executionId: revId,
                    step: {id: rid},
                })
            }
            return
        }

        // ── Unified execution path (single-node and chain) ──────────────
        const nodes = get(playgroundNodesAtom)
        const connections = get(outputConnectionsAtom)

        const rootNode = nodes.find((n) => n.depth === 0)
        if (!rootNode) return
        const rootEntityId = rootNode.entityId
        if (!rootEntityId) return

        // Skip downstream entities ONLY when no targetNodeId is provided.
        // When targetNodeId is explicitly set, the caller wants to run
        // just that specific stage — the runner will handle skipping other stages.
        const isDownstreamEntity =
            effectiveId !== rootEntityId &&
            nodes.some(
                (n) =>
                    n.entityId === effectiveId &&
                    n.depth > 0 &&
                    connections.some((c) => c.targetNodeId === n.id),
            )
        if (isDownstreamEntity && !params.targetNodeId) return

        const loadableId = get(derivedLoadableIdAtom)
        if (!loadableId) return

        const getHeaders = get(executionHeadersAtom)
        const headers: Record<string, string> = getHeaders ? await getHeaders() : {}
        const isChat = get(isChatModeAtom) === true
        const mode = isChat ? "chat" : "completion"
        const logicalRowId = extractLogicalRowId(rowId)

        const sessionId = `sess:${rootEntityId}`
        const runId = `run-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`

        // For chat re-runs, clear previous assistant/tool responses for this
        // session from the current turn onward before starting a new run.
        if (isChat) {
            set(clearSessionResponsesAtom, {
                loadableId,
                sessionId,
                afterUserMessageId: logicalRowId,
            })
        }

        // Determine which node is the target (if any)
        const targetNode = params.targetNodeId
            ? nodes.find((n) => n.id === params.targetNodeId)
            : undefined
        const isTargetingDownstream = targetNode && targetNode.depth > 0
        const nodeById = new Map(nodes.map((n) => [n.id, n]))

        // Mark nodes as running.
        // - Full chain (no targetNodeId): mark root + all downstream
        // - Targeted root: mark root only
        // - Targeted downstream: mark ONLY the target (don't reset root's result)
        if (isTargetingDownstream) {
            // Only mark the downstream target — preserve root's existing result
            set(startRunAtom, {
                loadableId,
                stepId: rowId,
                sessionId: `sess:${targetNode.entityId}`,
                runId,
            })
        } else {
            // Full chain or targeted root: mark root as running
            set(startRunAtom, {loadableId, stepId: rowId, sessionId, runId})

            if (!params.targetNodeId) {
                // Full chain: mark all downstream nodes too
                for (const n of nodes) {
                    if (n.depth === 0) continue
                    if (connections.some((c) => c.targetNodeId === n.id)) {
                        set(startRunAtom, {
                            loadableId,
                            stepId: rowId,
                            sessionId: `sess:${n.entityId}`,
                            runId,
                        })
                    }
                }
            }
        }

        // Get testcase row data from the loadable
        const rowEntry = get(loadableController.selectors.row(loadableId, logicalRowId)) as {
            data?: Record<string, unknown>
        } | null
        const testcaseData: Record<string, unknown> = rowEntry?.data ?? {}

        await executeStepForSessionWithExecutionItems({
            get,
            set,
            loadableId,
            stepId: rowId,
            session: {
                id: sessionId,
                runnableId: rootEntityId,
                runnableType: (rootNode.entityType || "legacyAppRevision") as RunnableType,
                mode,
            },
            data: testcaseData,
            nodes,
            allConnections: connections,
            sessionOptions: {[sessionId]: {headers}},
            targetNodeId: params.targetNodeId,
            lifecycle: {
                onStart: () => {},
                onProgress: ({chainProgress, chainResults}) => {
                    // Store chain progress on the root session so
                    // chainExecutionStatusAtomFamily can read which node is active.
                    set(updateChainProgressAtom, {
                        loadableId,
                        stepId: rowId,
                        sessionId,
                        chainProgress,
                        chainResults,
                    })

                    // Publish completed stage outputs incrementally so already-finished
                    // chain steps render while downstream steps are still running.
                    if (chainResults) {
                        for (const [nodeId, stageResult] of Object.entries(chainResults)) {
                            const node = nodeById.get(nodeId)
                            if (!node) continue
                            const stageSessionId = `sess:${node.entityId}`
                            if (stageResult.status === "error") {
                                set(failRunAtom, {
                                    loadableId,
                                    stepId: rowId,
                                    sessionId: stageSessionId,
                                    error: stageResult.error || {message: "Execution failed"},
                                })
                                continue
                            }
                            set(completeRunAtom, {
                                loadableId,
                                stepId: rowId,
                                sessionId: stageSessionId,
                                result: {
                                    output: {response: stageResult.structuredOutput},
                                    structuredOutput: stageResult.structuredOutput,
                                    traceId: stageResult.traceId,
                                    metrics: stageResult.metrics,
                                },
                            })
                        }
                    }
                },
                onComplete: ({result}) => {
                    // Wrap output in {response: structuredOutput} to match the
                    // result shape that deriveToolViewModelFromResult expects
                    // (it reads result.response.data for display text).
                    const wrappedOutput = {response: result.structuredOutput}

                    // Chat mode: route through handleExecutionResultAtom to
                    // write assistant/tool messages to the chat message store.
                    // Without this, assistantForTurn returns null and chat
                    // responses never render.
                    if (isChat && !isTargetingDownstream) {
                        set(handleExecutionResultAtom, {
                            loadableId,
                            sessionId,
                            rowId,
                            result: wrappedOutput,
                        })
                    }

                    // For targeted downstream execution, don't overwrite the
                    // root session's result — only update chainResults on it.
                    if (isTargetingDownstream) {
                        // Update root's chainResults without resetting its output
                        set(completeRunAtom, {
                            loadableId,
                            stepId: rowId,
                            sessionId,
                            result: {
                                // Preserve root's existing output by not setting
                                // output/structuredOutput/traceId/metrics.
                                // completeRunAtom merges with existing via spread.
                                isChain: result.isChain,
                                totalStages: result.totalStages,
                                chainResults: result.chainResults,
                            },
                        })
                    } else {
                        // Full chain or targeted root: store primary node result
                        set(completeRunAtom, {
                            loadableId,
                            stepId: rowId,
                            sessionId,
                            result: {
                                output: wrappedOutput,
                                structuredOutput: result.structuredOutput,
                                traceId: result.traceId,
                                metrics: result.metrics,
                                isChain: result.isChain,
                                totalStages: result.totalStages,
                                chainResults: result.chainResults,
                                ...(result.repetitions ? {repetitions: result.repetitions} : {}),
                            },
                        })
                    }

                    // Store separate result entries for each downstream node
                    // so the UI can look them up by their own entityId.
                    if (result.chainResults) {
                        for (const [nodeId, stageResult] of Object.entries(result.chainResults)) {
                            const node = nodes.find((n) => n.id === nodeId)
                            if (!node || node.depth === 0) continue
                            const stageSessionId = `sess:${node.entityId}`
                            if (stageResult.status === "error") {
                                set(failRunAtom, {
                                    loadableId,
                                    stepId: rowId,
                                    sessionId: stageSessionId,
                                    error: stageResult.error || {message: "Execution failed"},
                                })
                                continue
                            }
                            set(completeRunAtom, {
                                loadableId,
                                stepId: rowId,
                                sessionId: stageSessionId,
                                result: {
                                    output: {response: stageResult.structuredOutput},
                                    structuredOutput: stageResult.structuredOutput,
                                    traceId: stageResult.traceId,
                                    metrics: stageResult.metrics,
                                },
                            })
                        }
                    }

                    const qc = get(queryClientAtom)
                    qc.invalidateQueries({queryKey: ["tracing"]})
                },
                onFail: ({error: err}) => {
                    // For targeted downstream runs, fail the target session, not root
                    const failSessionId = isTargetingDownstream
                        ? `sess:${targetNode.entityId}`
                        : sessionId
                    console.error("[triggerExecution] onFail:", {
                        error: err,
                        isTargetingDownstream,
                        failSessionId,
                        targetNodeId: params.targetNodeId,
                    })
                    set(failRunAtom, {
                        loadableId,
                        stepId: rowId,
                        sessionId: failSessionId,
                        error: err,
                    })
                },
                onCancel: () => {
                    const cancelSessionId = isTargetingDownstream
                        ? `sess:${targetNode.entityId}`
                        : sessionId
                    set(cancelRunAtom, {loadableId, stepId: rowId, sessionId: cancelSessionId})
                },
            },
        })
    },
)

// ============================================================================
// RESULT HANDLER ATOM
// ============================================================================

/**
 * Handle a web worker execution result.
 *
 * Processes the result and updates execution state, chat turns, etc.
 */
export const handleExecutionResultFromWorkerAtom = atom(
    null,
    (
        get,
        set,
        payload: {
            rowId: string
            entityId: string
            runId: string
            result?: unknown
            error?: unknown
            messageId?: string
        },
    ) => {
        const {rowId, entityId, runId, result: testResult, error, messageId: _messageId} = payload

        const pendingRequests = get(pendingWebWorkerRequestsAtom)
        const _pendingEntry = pendingRequests?.[runId]
        set(pendingWebWorkerRequestsAtom, (prev) => {
            const {[runId]: _removed, ...rest} = prev
            return rest
        })

        const ignored = get(ignoredWebWorkerRunIdsAtom)
        if (runId && ignored?.[runId]) {
            set(ignoredWebWorkerRunIdsAtom, (prev) => {
                const {[runId]: _omit, ...rest} = prev
                return rest
            })
            // Cancel this run in the package (marks status as cancelled)
            const loadableId = get(derivedLoadableIdAtom)
            if (loadableId) {
                set(cancelRunAtom, {
                    loadableId,
                    stepId: rowId,
                    sessionId: `sess:${entityId}`,
                })
            }
            return
        }

        if (error && !testResult) {
            const errorMessage =
                typeof error === "string"
                    ? error
                    : isPlainObject(error) && typeof error.message === "string"
                      ? error.message
                      : "Unknown error"
            // Register failure in package execution state
            const loadableId = get(derivedLoadableIdAtom)
            if (loadableId) {
                set(failRunAtom, {
                    loadableId,
                    stepId: rowId,
                    sessionId: `sess:${entityId}`,
                    error: {
                        message: errorMessage,
                    },
                })
            }
            return
        }

        const loadableId = get(derivedLoadableIdAtom) as string
        const sessionId = `sess:${entityId}`

        if (loadableId) {
            set(handleExecutionResultAtom, {
                loadableId,
                sessionId,
                rowId,
                result: testResult,
            })
        }

        const queryClient = get(queryClientAtom)
        queryClient.invalidateQueries({queryKey: ["tracing"]})
    },
)

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Extract the logical row ID from a turn-style row ID.
 * Turn IDs have format: `turn-<entityId>-<logicalId>`.
 * If it's already a logical ID (starts with "lt-"), return as-is.
 */
function extractLogicalRowId(rowId: string): string {
    const match = /^turn-([^-]+)-(lt-.+)$/.exec(rowId)
    return match?.[2] || rowId
}
