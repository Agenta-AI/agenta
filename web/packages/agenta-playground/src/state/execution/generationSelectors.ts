/**
 * Generation Selectors
 *
 * Higher-level derived selectors for playground generation UI.
 * These were migrated from OSS `generationProperties.ts`, `testExecution.ts`,
 * `utilityMutations.ts`, and `derived/canRunAllChatComparison.ts`.
 *
 * This is a **separate file** from `selectors.ts` to keep generation-focused
 * selectors and mutations isolated from the core execution selectors.
 *
 * @module execution/generationSelectors
 */

import {loadableController} from "@agenta/entities/runnable"
import {atom} from "jotai"
import {atomFamily} from "jotai-family"

import {entityIdsAtom} from "../atoms/playground"
import {
    sharedMessageIdsWithContextAtom,
    messagesByIdWithContextAtom,
    clearAllMessagesWithContextAtom,
    truncateChatWithContextAtom,
    childMessageIndexWithContextAtom,
} from "../chat"
import type {ChatMessage} from "../chat/messageTypes"

import {createExecutionItemHandle} from "./executionItems"
import {resetExecutionAtom} from "./reducer"
import {
    derivedLoadableIdAtom,
    isChatModeAtom,
    executionRowIdsAtom,
    fullResultByRowRevisionAtomFamily,
    renderableExecutionItemsAtom,
    renderableExecutionRowsAtom,
    isAnyRunningForRowAtomFamily,
    executionRowIdsForEntityAtomFamily,
} from "./selectors"
import {extractTraceIdFromPayload} from "./trace"
import type {CancelTestsParams} from "./types"
import {
    type TriggerExecutionItemPayload,
    executionWorkerBridgeAtom,
    pendingWebWorkerRequestsAtom,
    ignoredWebWorkerRunIdsAtom,
    triggerWebWorkerTestAtom,
} from "./webWorkerIntegration"

const asRecord = (value: unknown): Record<string, unknown> | null => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null
    return value as Record<string, unknown>
}

// ============================================================================
// GENERATION RESULT SELECTORS
// ============================================================================

/**
 * Resolved generation result for a single cell (row + entity).
 *
 * Single canonical selector combining lifecycle status, response output,
 * full result (trace, error, metrics), and loading state.
 *
 * Used by useExecutionCell and ExecutionHeader.
 */
export const resolvedGenerationResultAtomFamily = atomFamily(
    (p: {entityId: string; rowId: string}) =>
        atom((get) => {
            const loadableId = get(derivedLoadableIdAtom)
            if (!loadableId)
                return {isRunning: false, resultHash: null, result: null, traceId: null}

            // Single read: get the RunResult directly
            const fullResult = get(
                fullResultByRowRevisionAtomFamily({rowId: p.rowId, revisionId: p.entityId}),
            )

            const status = fullResult?.status
            const isRunning = status === "running" || status === "pending"
            const resultHash = fullResult?.resultHash ?? null
            const result = fullResult?.output ?? null
            const traceId =
                fullResult?.traceId ?? extractTraceIdFromPayload(fullResult?.output) ?? null

            return {isRunning, resultHash, result, traceId}
        }),
)

/**
 * Header data for generations view (aggregated running state and results per entity).
 */
export const generationHeaderDataAtomFamily = atomFamily((entityId: string) =>
    atom((get) => {
        const rowIds = get(executionRowIdsAtom)
        let isRunning = false
        let resultCount = 0

        for (const rowId of rowIds) {
            const fullResult = get(fullResultByRowRevisionAtomFamily({rowId, revisionId: entityId}))
            if (!isRunning) {
                const status = fullResult?.status
                if (status === "running" || status === "pending") isRunning = true
            }
            if (fullResult?.output) {
                const output = fullResult.output
                resultCount += Array.isArray(output) ? output.filter(Boolean).length : 1
            }
        }

        return {resultCount, isRunning}
    }),
)

// ============================================================================
// VARIABLE ROW IDS (with auto-init)
// ============================================================================

/**
 * Variable row IDs for the current playground context.
 * - Chat mode: returns the first available variable row (shared variable row)
 * - Completion mode: returns variable row IDs from the loadable
 *
 * NOTE: Initial row creation is handled by linkToRunnable (via addPrimaryNode).
 * Do NOT auto-init rows here — it races with linkToRunnable and creates duplicates.
 */
export const generationVariableRowIdsAtom = atom((get) => {
    const isChat = get(isChatModeAtom)

    if (isChat === undefined) return []

    const loadableId = get(derivedLoadableIdAtom)
    if (!loadableId) return []

    const rowIds = get(loadableController.selectors.displayRowIds(loadableId))

    if (isChat) {
        // Chat uses a single shared variable row (first available row).
        return rowIds.length > 0 ? [rowIds[0]] : []
    }

    return rowIds
})

// ============================================================================
// CANCEL TESTS MUTATION
// ============================================================================

/**
 * Trigger execution across multiple execution IDs for a single step.
 * Orchestration-level action kept outside worker transport module.
 */
export interface TriggerExecutionItemsPayload {
    executionIds: string[]
    step: TriggerExecutionItemPayload["step"]
}

export const triggerWebWorkerTestsAtom = atom(
    null,
    (_get, set, params: TriggerExecutionItemsPayload) => {
        const {executionIds, step} = params
        for (const executionId of executionIds) {
            if (!executionId) continue
            set(triggerWebWorkerTestAtom, {executionId, step})
        }
    },
)

/**
 * Cancel running tests across web worker and package execution state.
 * Supports filtering by rowId, entityId, or entityIds.
 */
export const cancelTestsMutationAtom = atom(null, async (get, set, params: CancelTestsParams) => {
    try {
        const {rowId, entityId, entityIds: paramEntityIds} = params || {}

        // Resolve target entities
        const targetEntityIds = paramEntityIds ?? (entityId ? [entityId] : get(entityIdsAtom))
        const targetRowIds = rowId ? [rowId] : get(executionRowIdsAtom)
        const loadableId = get(derivedLoadableIdAtom)

        // 1) Signal web worker to abort matching in-flight runs

        const webWorker = get(executionWorkerBridgeAtom)
        if (webWorker) {
            const {postMessageToWorker, createWorkerMessage} = webWorker
            const pending = get(pendingWebWorkerRequestsAtom)
            const runIdsToCancel: string[] = []

            Object.values(pending).forEach((req) => {
                const matchesEntity = targetEntityIds.includes(req.entityId)
                const matchesRow = rowId ? req.rowId === rowId : true
                if (matchesEntity && matchesRow) {
                    runIdsToCancel.push(req.runId)
                }
            })

            if (runIdsToCancel.length > 0) {
                set(ignoredWebWorkerRunIdsAtom, (prev) => {
                    const next = {...prev}
                    runIdsToCancel.forEach((rid) => {
                        next[rid] = true
                    })
                    return next
                })
            }

            runIdsToCancel.forEach((rid) => {
                try {
                    postMessageToWorker(createWorkerMessage("cancelRun", {runId: rid}))
                } catch (e) {
                    console.warn("Failed to post cancelRun to worker", e)
                }
            })

            // Remove cancelled runs from pending list
            if (runIdsToCancel.length > 0) {
                set(pendingWebWorkerRequestsAtom, (prev) => {
                    const next = {...prev}
                    runIdsToCancel.forEach((rid) => delete next[rid])
                    return next
                })
            }
        }

        // 2) Cancel target execution items via execution-item lifecycle API
        if (loadableId) {
            for (const targetEntityId of targetEntityIds) {
                if (!targetEntityId) continue
                for (const targetRowId of targetRowIds) {
                    if (!targetRowId) continue
                    const handle = createExecutionItemHandle({
                        loadableId,
                        rowId: targetRowId,
                        revisionId: targetEntityId,
                    })
                    handle.cancel({get, set})
                }
            }
        }

        return {success: true, message: "Tests cancelled successfully"}
    } catch (error) {
        return {
            success: false,
            error: error instanceof Error ? error.message : "Failed to cancel tests",
        }
    }
})

// ============================================================================
// CLEAR ALL RUNS MUTATION
// ============================================================================

/**
 * Clear all execution results and chat turns.
 */
export const clearAllRunsMutationAtom = atom(null, (get, set) => {
    const isChat = get(isChatModeAtom)

    const lid = get(derivedLoadableIdAtom)
    if (lid) {
        set(resetExecutionAtom, {loadableId: lid})
    }

    if (isChat) {
        set(clearAllMessagesWithContextAtom)
    }
})

// ============================================================================
// CAN RUN ALL CHAT COMPARISON
// ============================================================================

const hasValidUser = (val: unknown): boolean => {
    if (typeof val === "string") return val.trim().length > 0
    if (Array.isArray(val)) {
        try {
            for (const p of val) {
                const type = p?.type?.value ?? p?.type
                if (type === "text") {
                    const t = typeof p?.text === "string" ? p.text : p?.text?.value
                    if ((t || "").trim().length > 0) return true
                }
                if (type === "image_url" || p?.imageUrl || p?.image_url) {
                    const url =
                        p?.imageUrl?.url?.value ??
                        p?.imageUrl?.value ??
                        p?.image_url?.url ??
                        p?.image_url ??
                        p?.url ??
                        ""
                    if (url) return true
                }
                if (type === "file" || p?.file) {
                    const fileId =
                        p?.file?.file_id?.value ??
                        p?.file?.file_id ??
                        p?.file_id?.value ??
                        p?.file_id ??
                        ""
                    if (fileId) return true
                }
            }
        } catch {}
    }
    return false
}

/**
 * Whether all chat comparison entities can be run.
 * Returns true if in chat mode, has displayed entities, and the last turn has valid user content.
 */
// ============================================================================
// ROW BUSY STATE
// ============================================================================

/**
 * Whether any entity is busy executing for a given row.
 * In single-entity mode (entityId provided), returns that entity's running state.
 * In multi-entity mode (no entityId), checks all displayed entities.
 */
export const isBusyForRowAtomFamily = atomFamily(
    ({rowId, entityId}: {rowId: string; entityId?: string}) =>
        atom((get) => {
            if (entityId) {
                const resolved = get(resolvedGenerationResultAtomFamily({entityId, rowId}))
                return Boolean(resolved?.isRunning)
            }
            return get(isAnyRunningForRowAtomFamily(rowId))
        }),
)

// ============================================================================
// AGGREGATED HEADER DATA
// ============================================================================

/**
 * Aggregated header data across all displayed entities.
 * Used in comparison view where no single entityId is provided.
 */
export const aggregatedHeaderDataAtom = atom((get) => {
    const isChat = get(isChatModeAtom)
    if (isChat) return {resultCount: 0, isRunning: false}

    const items = get(renderableExecutionItemsAtom)
    const entityIds = Array.from(new Set(items.map((item) => item.executionId)))

    let totalResultCount = 0
    let isRunning = false

    for (const eid of entityIds) {
        const data = get(generationHeaderDataAtomFamily(eid))
        if (data.isRunning) isRunning = true
        totalResultCount += data.resultCount
    }

    return {resultCount: totalResultCount, isRunning}
})

// ============================================================================
// TURN-LEVEL MESSAGE SELECTORS
// ============================================================================

/**
 * Get the assistant message for a specific turn and session.
 * Uses the pre-built parent index for O(1) lookup.
 */
export const assistantForTurnAtomFamily = atomFamily(
    ({turnId, sessionId}: {turnId: string; sessionId: string}) =>
        atom((get) => {
            const index = get(childMessageIndexWithContextAtom)
            return index[`${turnId}:${sessionId}`]?.assistant ?? null
        }),
)

/**
 * Get tool messages for a specific turn and session.
 * Uses the pre-built parent index for O(1) lookup.
 */
export const toolsForTurnAtomFamily = atomFamily(
    ({turnId, sessionId}: {turnId: string; sessionId: string}) =>
        atom((get) => {
            const index = get(childMessageIndexWithContextAtom)
            return index[`${turnId}:${sessionId}`]?.tools ?? []
        }),
)

// ============================================================================
// RERUN FROM TURN
// ============================================================================

/**
 * Re-run from a specific chat turn: truncate everything after it, then trigger execution.
 */
export const rerunFromTurnAtom = atom(
    null,
    (get, set, params: {turnId: string; executionIds: string[]; userMessageId?: string}) => {
        const {turnId, executionIds, userMessageId} = params
        const sharedIds = get(sharedMessageIdsWithContextAtom) as string[]
        const idx = sharedIds.indexOf(turnId)
        const isLast = idx >= 0 && idx === sharedIds.length - 1

        if (!isLast && userMessageId) {
            set(truncateChatWithContextAtom, {afterTurnId: turnId})
        }

        for (const executionId of executionIds) {
            if (!executionId) continue
            set(triggerWebWorkerTestAtom, {
                executionId,
                step: {id: turnId, messageId: userMessageId},
            })
        }
    },
)

// ============================================================================
// RUN ALL ORCHESTRATION
// ============================================================================

/**
 * Run all tests: handles chat/completion × single/comparison branching.
 * - Chat mode: runs the last turn for target entities
 * - Completion single: runs all rows for the given entity
 * - Completion comparison: runs all renderable items
 */
export const runAllWithContextAtom = atom(null, (get, set, params?: {entityId?: string}) => {
    const entityId = params?.entityId
    const isChat = get(isChatModeAtom)
    const isComparisonView = !entityId

    if (isChat) {
        if (isComparisonView) {
            const canRun = get(canRunAllChatComparisonAtom)
            if (!canRun) return
        }
        const rows = get(renderableExecutionRowsAtom)
        const lastId = rows[rows.length - 1]?.rowId
        if (!lastId) return

        const entityIds = get(entityIdsAtom)
        const targets = entityId ? [entityId] : entityIds.length > 0 ? entityIds : []
        for (const rev of targets) {
            set(triggerWebWorkerTestAtom, {executionId: rev, step: {id: lastId}})
        }
    } else if (entityId) {
        const rowIds = get(executionRowIdsForEntityAtomFamily(entityId))
        for (const rid of rowIds) {
            set(triggerWebWorkerTestAtom, {executionId: entityId, step: {id: rid}})
        }
    } else {
        const items = get(renderableExecutionItemsAtom)
        for (const item of items) {
            set(triggerWebWorkerTestAtom, {
                executionId: item.executionId,
                step: {id: item.rowId},
            })
        }
    }
})

// ============================================================================
// ROW-LEVEL RUN / CANCEL
// ============================================================================

/**
 * Run a single row across all variants (or a specific entity).
 */
export const runRowAtom = atom(null, (get, set, params: {rowId: string; entityId?: string}) => {
    const {rowId, entityId} = params
    if (entityId) {
        set(triggerWebWorkerTestAtom, {executionId: entityId, step: {id: rowId}})
        return
    }
    const items = get(renderableExecutionItemsAtom)
    const entityIds = Array.from(new Set(items.map((item) => item.executionId)))
    for (const vid of entityIds) {
        set(triggerWebWorkerTestAtom, {executionId: vid, step: {id: rowId}})
    }
})

/**
 * Cancel a single row across relevant entities.
 */
export const cancelRowAtom = atom(null, (get, set, params: {rowId: string; entityId?: string}) => {
    const {rowId, entityId} = params
    if (entityId) {
        set(cancelTestsMutationAtom, {rowId, entityId})
        return
    }
    const items = get(renderableExecutionItemsAtom)
    const entityIds = Array.from(new Set(items.map((item) => item.executionId)))
    set(cancelTestsMutationAtom, {rowId, entityIds})
})

// ============================================================================
// CANCEL ALL
// ============================================================================

/**
 * Cancel all running tests across all entities and rows.
 */
export const cancelAllWithContextAtom = atom(null, (_get, set) => {
    set(cancelTestsMutationAtom, {})
})

// ============================================================================
// CAN RUN ALL CHAT COMPARISON
// ============================================================================

export const canRunAllChatComparisonAtom = atom((get) => {
    const isChat = get(isChatModeAtom)
    if (!isChat) return false

    const displayed = get(entityIdsAtom)
    if (!Array.isArray(displayed) || displayed.length === 0) return false

    const sharedIds = get(sharedMessageIdsWithContextAtom) as string[]
    if (!sharedIds.length) return false

    // Only check the last shared message — no need to read the full map
    const lastId = sharedIds[sharedIds.length - 1]
    const byId = get(messagesByIdWithContextAtom) as Record<string, ChatMessage>
    const msg = byId[lastId]
    if (!msg) return false

    const userMessage = asRecord(msg)
    const content = asRecord(userMessage?.content)
    const val = content?.value ?? userMessage?.content
    return hasValidUser(val)
})
