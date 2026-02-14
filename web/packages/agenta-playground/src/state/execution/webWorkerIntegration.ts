/**
 * Web Worker Integration
 *
 * Orchestrates execution via web worker:
 * - Builds payloads from entity/playground state
 * - Dispatches work to the web worker
 * - Processes results back into chat turns and execution state
 *
 * Moved from OSS `state/newPlayground/mutations/webWorkerIntegration.ts`.
 * All imports use package / @agenta/entities / @agenta/shared APIs.
 *
 * @module execution/webWorkerIntegration
 */

import {projectIdAtom} from "@agenta/shared/state"
import {isPlainObject} from "@agenta/shared/utils"
import {atom, getDefaultStore, type Getter} from "jotai"
import {queryClientAtom} from "jotai-tanstack-query"

import {entityIdsAtom} from "../atoms/playground"

import {createExecutionItemHandle, handleExecutionResultAtom} from "./executionItems"
import {startRunAtom, failRunAtom, cancelRunAtom} from "./reducer"
import {derivedLoadableIdAtom} from "./selectors"

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
}

/**
 * Injectable worker bridge used by execution atoms.
 *
 * OSS/EE should set this at app init via provider code.
 */
export const executionWorkerBridgeAtom = atom<ExecutionWorkerBridge | null>(null)

function getWorkerBridge(get: Getter): ExecutionWorkerBridge | null {
    return (get(executionWorkerBridgeAtom) as ExecutionWorkerBridge | null) ?? null
}

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
 * Trigger a web worker execution for an execution item.
 *
 * Payload shape: `{ executionId, step: { id, messageId? } }`.
 *
 * This is the main entry point for running an entity from the playground.
 * Builds the payload from entity/playground state and dispatches to the web worker.
 */
export const triggerWebWorkerTestAtom = atom(
    null,
    async (get, set, params: TriggerExecutionItemPayload) => {
        const rowId = params.step.id
        const requestedRevisionId = params.executionId
        const messageId = params.step.messageId

        const webWorker = getWorkerBridge(get)
        if (!webWorker) return
        const {postMessageToWorker, createWorkerMessage} = webWorker

        const entityIds = (get(entityIdsAtom) || []) as string[]
        const effectiveId = requestedRevisionId || entityIds[0] || null
        if (!effectiveId) return

        // Derive logicalId from provided rowId (session id: turn-<rev>-<logicalId> or logical id itself)
        const sessionMatch = /^turn-([^-]+)-(lt-.+)$/.exec(String(rowId))
        const logicalIdFromRow =
            sessionMatch?.[2] || (String(rowId).startsWith("lt-") ? String(rowId) : "")

        if (!requestedRevisionId) {
            if (Array.isArray(entityIds) && entityIds.length > 1) {
                const lid = logicalIdFromRow || String(rowId)
                for (const revId of entityIds) {
                    if (!revId) continue
                    const rid = `turn-${revId}-${lid}`
                    set(triggerWebWorkerTestAtom, {
                        executionId: revId,
                        step: {id: rid},
                    })
                }
                return
            }
        }

        const loadableId = get(derivedLoadableIdAtom)
        if (!loadableId) return

        const store = getDefaultStore()
        const projectId = store.get(projectIdAtom)

        // Get auth headers from injectable provider
        const getHeaders = get(executionHeadersAtom)
        const headers: Record<string, string> = getHeaders ? await getHeaders() : {}

        const executionItemHandle = createExecutionItemHandle({
            loadableId,
            rowId,
            revisionId: effectiveId,
            messageId,
        })
        const executionItem = executionItemHandle.run({
            get,
            headers,
            projectId,
            dispatchWorkerRun: (workerPayload) => {
                postMessageToWorker(createWorkerMessage("runVariantRow", workerPayload))
            },
        })
        if (!executionItem) return
        const runId = executionItem.invocation.runId

        set(startRunAtom, {
            loadableId,
            stepId: rowId,
            sessionId: `sess:${effectiveId}`,
            runId,
        })

        set(pendingWebWorkerRequestsAtom, (prev) => ({
            ...prev,
            [runId]: {
                rowId,
                entityId: effectiveId,
                runId,
                timestamp: Date.now(),
            },
        }))
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
export const handleWebWorkerResultAtom = atom(
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
