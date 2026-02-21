/**
 * Execution Module Selectors
 *
 * Higher-level derived selectors for common execution state queries.
 * These build on the base atoms to provide convenient access patterns.
 *
 * @module execution/selectors
 */

import {loadableController, runnableBridge, type RunnablePort} from "@agenta/entities/runnable"
import {testcaseMolecule} from "@agenta/entities/testcase"
import {atom, type Getter} from "jotai"
import {selectAtom} from "jotai/utils"
import {getDefaultStore} from "jotai/vanilla"
import {atomFamily} from "jotai-family"

import {entityIdsAtom, playgroundNodesAtom} from "../atoms/playground"
import {addUserMessageAtom} from "../chat"
import {sharedMessageIdsAtomFamily} from "../chat/messageSelectors"

import {
    executionModeAtomFamily,
    sessionsAtomFamily,
    activeSessionsAtomFamily,
    stepsAtomFamily,
    resultsForStepAtomFamily,
    resultAtomFamily,
    isStepRunningAtomFamily,
    isAnyExecutingAtomFamily,
    stepAtomFamily,
    sessionAtomFamily,
    resultsByKeyAtomFamily,
} from "./atoms"
import {displayedEntityIdsAtom} from "./displayedEntities"
import {createExecutionItemHandle, type ExecutionItemLifecycleSnapshot} from "./executionItems"
import type {RunStatus} from "./types"

// ============================================================================
// CONTEXT SELECTORS (derived from playground state)
// ============================================================================

/**
 * Derived loadableId from primary node
 *
 * This allows execution to work without manually constructing loadableId.
 * Format: "testset:{entityType}:{entityId}"
 *
 * @returns Atom for the derived loadableId or empty string if no primary node
 *
 * @example
 * const loadableId = useAtomValue(derivedLoadableIdAtom)
 * // Returns "testset:appRevision:rev-123" if primary node is an app revision
 */
export const derivedLoadableIdAtom = atom((get) => {
    const rootNode = get(playgroundNodesAtom).find((n) => n.depth === 0)
    if (!rootNode) return ""
    return `testset:${rootNode.entityType}:${rootNode.entityId}`
})

/**
 * Active sessions using derived loadableId
 *
 * Convenience selector that uses the derived loadableId from primary node.
 *
 * @example
 * const sessions = useAtomValue(activeSessionsWithContextAtom)
 */
export const activeSessionsWithContextAtom = atom((get) => {
    const loadableId = get(derivedLoadableIdAtom)
    if (!loadableId) return []
    return get(activeSessionsAtomFamily(loadableId))
})

/**
 * Is compare mode using derived loadableId
 *
 * @example
 * const isCompareMode = useAtomValue(isCompareModeWithContextAtom)
 */
export const isCompareModeWithContextAtom = atom((get) => {
    const loadableId = get(derivedLoadableIdAtom)
    if (!loadableId) return false
    return get(activeSessionsAtomFamily(loadableId)).length > 1
})

/**
 * Is any executing using derived loadableId
 *
 * @example
 * const isExecuting = useAtomValue(isAnyExecutingWithContextAtom)
 */
export const isAnyExecutingWithContextAtom = atom((get) => {
    const loadableId = get(derivedLoadableIdAtom)
    if (!loadableId) return false
    return get(isAnyExecutingAtomFamily(loadableId))
})

/**
 * Execution progress using derived loadableId
 *
 * @example
 * const progress = useAtomValue(executionProgressWithContextAtom)
 */
export const executionProgressWithContextAtom = atom((get) => {
    const loadableId = get(derivedLoadableIdAtom)
    if (!loadableId) {
        return {
            total: 0,
            completed: 0,
            running: 0,
            percentage: 0,
            isComplete: false,
            isRunning: false,
        }
    }
    return get(executionProgressAtomFamily(loadableId))
})

/**
 * Context-aware row data selector.
 *
 * Reads the row from the loadable linked to the current primary node.
 */
export const rowDataWithContextAtomFamily = atomFamily((rowId: string) =>
    atom((get) => {
        const loadableId = get(derivedLoadableIdAtom)
        if (!loadableId) return null
        const rows = get(loadableController.selectors.rows(loadableId))
        const row = rows.find((item) => item.id === rowId)
        if (!row) return null
        return {
            id: row.id,
            data: row.data,
        }
    }),
)

/**
 * Context-aware variable value for a specific row + variable key.
 *
 * Avoids over-subscribing to the full row data object — only re-renders
 * when the specific variable value changes.
 */
export const rowVariableValueAtomFamily = atomFamily(
    ({rowId, variableId}: {rowId: string; variableId: string}) =>
        atom((get) => {
            if (!variableId) return ""
            const row = get(rowDataWithContextAtomFamily(rowId))
            const value = row?.data?.[variableId]
            return typeof value === "string" ? value : String(value ?? "")
        }),
)

/**
 * Context-aware variable keys for generation input rows.
 *
 * Keys are derived from the linked runnable columns.
 */
export const rowVariableKeysWithContextAtom = atom<string[]>((get) => {
    const loadableId = get(derivedLoadableIdAtom)
    if (!loadableId) return []
    const columns = get(loadableController.selectors.columns(loadableId))
    return columns.map((column) => column.key)
})

// ============================================================================
// DIRECT TESTCASE ENTITY SELECTORS
// ============================================================================

/**
 * Direct testcase cell value — reads a single field from the testcase entity.
 *
 * Uses testcaseMolecule.atoms.cell which is a selectAtom with equality check,
 * so it only re-renders when the specific cell value changes.
 *
 * This bypasses the loadable row indirection:
 *   OLD: rowVariableValueAtomFamily → rowDataWithContext → loadable.rows → .find() → toRow()
 *   NEW: testcaseMolecule.atoms.cell({id, column}) → selectAtom on entity
 *
 * Since rowId === testcaseId (loadableController always routes through testcaseMolecule),
 * the UI can address testcase entities directly.
 */
export const testcaseCellValueAtomFamily = atomFamily(
    ({testcaseId, column}: {testcaseId: string; column: string}) =>
        atom((get) => {
            if (!testcaseId || !column) return ""
            const value = get(testcaseMolecule.atoms.cell({id: testcaseId, column}))
            return value !== undefined && value !== null ? String(value) : ""
        }),
    (a, b) => a.testcaseId === b.testcaseId && a.column === b.column,
)

/**
 * Direct testcase entity data — reads the full testcase entity.
 *
 * Returns the testcase's data record (the nested `data` property),
 * or null if the testcase doesn't exist.
 */
export const testcaseDataAtomFamily = atomFamily((testcaseId: string) =>
    atom((get) => {
        if (!testcaseId) return null
        const entity = get(testcaseMolecule.data(testcaseId))
        if (!entity) return null
        return {
            id: testcaseId,
            data: (entity as {data?: Record<string, unknown>}).data ?? {},
        }
    }),
)

// ============================================================================
// SESSION SELECTORS
// ============================================================================

/**
 * Get session count for a loadable
 *
 * @param loadableId - The loadable instance ID
 * @returns Atom for the session count
 */
export const sessionCountAtomFamily = atomFamily((loadableId: string) =>
    atom((get) => get(sessionsAtomFamily(loadableId)).length),
)

/**
 * Get active session count for a loadable
 *
 * @param loadableId - The loadable instance ID
 * @returns Atom for the active session count
 */
export const activeSessionCountAtomFamily = atomFamily((loadableId: string) =>
    atom((get) => get(activeSessionsAtomFamily(loadableId)).length),
)

/**
 * Check if in compare mode (multiple active sessions)
 *
 * @param loadableId - The loadable instance ID
 * @returns Atom that returns true if comparing multiple sessions
 */
export const isCompareModeAtomFamily = atomFamily((loadableId: string) =>
    atom((get) => get(activeSessionsAtomFamily(loadableId)).length > 1),
)

/**
 * Get session labels for display
 *
 * @param loadableId - The loadable instance ID
 * @returns Atom for session labels mapped by ID
 */
export const sessionLabelsAtomFamily = atomFamily((loadableId: string) =>
    atom((get) => {
        const sessions = get(sessionsAtomFamily(loadableId))
        const labels: Record<string, string> = {}
        for (const session of sessions) {
            labels[session.id] = session.label || session.runnableId
        }
        return labels
    }),
)

// ============================================================================
// STEP SELECTORS
// ============================================================================

/**
 * Get step count for a loadable
 *
 * @param loadableId - The loadable instance ID
 * @returns Atom for the step count
 */
export const stepCountAtomFamily = atomFamily((loadableId: string) =>
    atom((get) => get(stepsAtomFamily(loadableId)).length),
)

/**
 * Get the latest step
 *
 * @param loadableId - The loadable instance ID
 * @returns Atom for the latest step or null
 */
export const latestStepAtomFamily = atomFamily((loadableId: string) =>
    atom((get) => {
        const steps = get(stepsAtomFamily(loadableId))
        return steps.length > 0 ? steps[steps.length - 1] : null
    }),
)

// ============================================================================
// RESULT SELECTORS
// ============================================================================

/**
 * Get aggregated status for a step across all sessions
 *
 * Returns the "worst" status: error > running > pending > idle > success
 *
 * @param params - Object with loadableId and stepId
 * @returns Atom for the aggregated step status
 */
export const stepAggregateStatusAtomFamily = atomFamily(
    ({loadableId, stepId}: {loadableId: string; stepId: string}) =>
        atom((get): RunStatus => {
            const results = get(resultsForStepAtomFamily({loadableId, stepId}))
            const statuses = Object.values(results).map((r) => r.status)

            if (statuses.length === 0) return "idle"
            if (statuses.includes("error")) return "error"
            if (statuses.includes("running")) return "running"
            if (statuses.includes("pending")) return "pending"
            if (statuses.every((s) => s === "success")) return "success"
            if (statuses.every((s) => s === "cancelled")) return "cancelled"
            return "idle"
        }),
)

/**
 * Get result summary for a step
 *
 * @param params - Object with loadableId and stepId
 * @returns Atom for step result summary
 */
export const stepResultSummaryAtomFamily = atomFamily(
    ({loadableId, stepId}: {loadableId: string; stepId: string}) =>
        atom((get) => {
            const results = get(resultsForStepAtomFamily({loadableId, stepId}))
            const values = Object.values(results)

            return {
                total: values.length,
                success: values.filter((r) => r.status === "success").length,
                error: values.filter((r) => r.status === "error").length,
                running: values.filter((r) => r.status === "running" || r.status === "pending")
                    .length,
                idle: values.filter((r) => r.status === "idle").length,
                cancelled: values.filter((r) => r.status === "cancelled").length,
            }
        }),
)

/**
 * Get all results for all steps and sessions
 *
 * Returns a flattened map of all results.
 *
 * @param loadableId - The loadable instance ID
 * @returns Atom for all results
 */
export const allResultsAtomFamily = atomFamily((loadableId: string) =>
    atom((get) => get(resultsByKeyAtomFamily(loadableId))),
)

/**
 * Get completed results count
 *
 * @param loadableId - The loadable instance ID
 * @returns Atom for count of completed (success/error/cancelled) results
 */
export const completedResultsCountAtomFamily = atomFamily((loadableId: string) =>
    atom((get) => {
        const results = get(resultsByKeyAtomFamily(loadableId))
        return Object.values(results).filter(
            (r) => r.status === "success" || r.status === "error" || r.status === "cancelled",
        ).length
    }),
)

/**
 * Get execution progress for UI display
 *
 * @param loadableId - The loadable instance ID
 * @returns Atom for execution progress info
 */
export const executionProgressAtomFamily = atomFamily((loadableId: string) =>
    atom((get) => {
        const results = get(resultsByKeyAtomFamily(loadableId))
        const values = Object.values(results)

        const total = values.length
        const completed = values.filter(
            (r) => r.status === "success" || r.status === "error" || r.status === "cancelled",
        ).length
        const running = values.filter(
            (r) => r.status === "running" || r.status === "pending",
        ).length

        return {
            total,
            completed,
            running,
            percentage: total > 0 ? Math.round((completed / total) * 100) : 0,
            isComplete: total > 0 && completed === total,
            isRunning: running > 0,
        }
    }),
)

// ============================================================================
// ROW-REVISION CONVENIENCE SELECTORS
// ============================================================================

/**
 * Key type for row-entity selectors.
 * Accepts either a string "rowId:entityId" or an object.
 */
type RowEntityKey = string | {rowId: string; entityId: string}

function parseRowEntityKey(param: RowEntityKey) {
    if (typeof param === "string") {
        const idx = param.indexOf(":")
        if (idx === -1) return {rowId: param, entityId: ""}
        return {rowId: param.slice(0, idx), entityId: param.slice(idx + 1)}
    }
    return param
}

function getExecutionItemLifecycleSnapshot(
    get: Getter,
    params: {rowId: string; entityId: string; loadableId?: string},
): ExecutionItemLifecycleSnapshot | null {
    const loadableId = params.loadableId || get(derivedLoadableIdAtom)
    if (!loadableId || !params.rowId || !params.entityId) return null

    const handle = createExecutionItemHandle({
        loadableId,
        rowId: params.rowId,
        entityId: params.entityId,
    })
    return handle.lifecycle.snapshot(get)
}

/**
 * Lifecycle snapshot for a single row + revision execution item.
 */
export const executionItemLifecycleAtomFamily = ((param: RowEntityKey) => {
    const {rowId, entityId} = parseRowEntityKey(param)
    return atom((get) => getExecutionItemLifecycleSnapshot(get, {rowId, entityId}))
}) as (param: RowEntityKey) => ReturnType<typeof atom<ExecutionItemLifecycleSnapshot | null>>

/**
 * Get the output/response for a row + entity.
 * Derives from execution state using loadableId from primary node.
 *
 * @param param - "rowId:entityId" string or {rowId, entityId} object
 * @returns Atom for the result output (or null)
 */
export const responseByRowEntityAtomFamily = ((param: RowEntityKey) => {
    const {rowId, entityId} = parseRowEntityKey(param)
    return atom((get) => {
        const loadableId = get(derivedLoadableIdAtom)
        if (!loadableId) return null
        const result = get(
            resultAtomFamily({loadableId, stepId: rowId, sessionId: `sess:${entityId}`}),
        )
        return result?.output ?? null
    })
}) as (param: RowEntityKey) => ReturnType<typeof atom<unknown>>

/**
 * Get loading state for a row + entity.
 * Returns true if the execution is running or pending.
 *
 * @param param - "rowId:entityId" string or {rowId, entityId} object
 * @returns Atom for loading boolean
 */
export const loadingByRowEntityAtomFamily = ((param: RowEntityKey) => {
    const {rowId, entityId} = parseRowEntityKey(param)
    return atom((get) => {
        const lifecycle = get(executionItemLifecycleAtomFamily({rowId, entityId}))
        return Boolean(lifecycle?.isRunning)
    })
}) as (param: RowEntityKey) => ReturnType<typeof atom<boolean>>

/**
 * Get the complete RunResult for a row + entity.
 * Exposes status, output, traceId, error, metrics, etc.
 *
 * @param param - "rowId:entityId" string or {rowId, entityId} object
 * @returns Atom for the full RunResult (or null)
 */
export const fullResultByRowEntityAtomFamily = ((param: RowEntityKey) => {
    const {rowId, entityId} = parseRowEntityKey(param)
    return atom((get) => {
        const loadableId = get(derivedLoadableIdAtom)
        if (!loadableId) return null
        return get(resultAtomFamily({loadableId, stepId: rowId, sessionId: `sess:${entityId}`}))
    })
}) as (param: RowEntityKey) => ReturnType<typeof atom<import("./types").RunResult | null>>

// ============================================================================
// RUN STATUS MAP
// ============================================================================

/**
 * Derived run status map keyed by `${rowId}:${entityId}`.
 *
 * Reads all results for the current loadable and reformats the package key
 * format (`stepId:sess:entityId`) into the consumer-friendly
 * `rowId:entityId` format.
 *
 * This is a read-only derivation — writes go through package atoms
 * (startRunAtom, completeRunAtom, etc.).
 */
export const runStatusByRowEntityAtom = selectAtom(
    atom((get) => {
        const loadableId = get(derivedLoadableIdAtom)
        if (!loadableId) return {}
        const all = get(resultsByKeyAtomFamily(loadableId))
        const mapped: Record<string, {isRunning?: string | false; resultHash?: string | null}> = {}
        for (const [key, result] of Object.entries(all)) {
            // Package key format: "stepId:sess:entityId"
            const sepIdx = key.indexOf(":sess:")
            if (sepIdx === -1) continue
            const stepId = key.slice(0, sepIdx)
            const entityId = key.slice(sepIdx + 5)
            const status = result?.status
            const isRunning = status === "running" || status === "pending"
            mapped[`${stepId}:${entityId}`] = {
                isRunning: isRunning ? result?.runId || "true" : false,
                resultHash: result?.resultHash ?? null,
            }
        }
        return mapped
    }),
    (v) => v,
    (a, b) => {
        const aKeys = Object.keys(a)
        const bKeys = Object.keys(b)
        if (aKeys.length !== bKeys.length) return false
        for (const k of aKeys) {
            const av = a[k]
            const bv = b[k]
            if (!bv || av?.isRunning !== bv?.isRunning || av?.resultHash !== bv?.resultHash)
                return false
        }
        return true
    },
)

// ============================================================================
// UNIFIED ROW ID SELECTORS
// ============================================================================

/**
 * Unified row IDs for generation rendering.
 *
 * - **completion mode**: returns loadable display row IDs (testcases)
 * - **chat mode**: returns shared (user) message IDs from flat model
 *
 * Replaces the OSS `generationLogicalTurnIdsAtom` / `generationRowIdsCompatAtom`.
 */
export const generationRowIdsAtom = atom<string[]>((get) => {
    const loadableId = get(derivedLoadableIdAtom)
    if (!loadableId) return []
    const isChat = get(isChatModeAtom)
    if (isChat) {
        const rowIds = get(sharedMessageIdsAtomFamily(loadableId))
        if (rowIds.length === 0) {
            // Bootstrap first blank user message for chat mode
            getDefaultStore().set(addUserMessageAtom, {loadableId, userMessage: null})
            return get(sharedMessageIdsAtomFamily(loadableId))
        }
        return rowIds
    }
    if (isChat === undefined) {
        return []
    }
    const stepIds = get(loadableController.selectors.displayRowIds(loadableId))
    return stepIds
})

/**
 * Unified execution row IDs.
 *
 * Alias of `generationRowIdsAtom` for clearer ownership semantics:
 * these IDs are the rows/turns that executions run against.
 */
export const executionRowIdsAtom = generationRowIdsAtom

// ============================================================================
// RENDERABLE EXECUTION ITEMS (UI SINGLE SOURCE OF TRUTH)
// ============================================================================

export interface RenderableExecutionItem {
    key: string
    rowId: string
    executionId: string
    rowIndex: number
    executionIndex: number
    isFirstRow: boolean
    isLastRow: boolean
    isFirstExecution: boolean
    isLastExecution: boolean
}

export interface RenderableExecutionRow {
    rowId: string
    rowIndex: number
    isFirstRow: boolean
    isLastRow: boolean
    items: RenderableExecutionItem[]
}

/**
 * Flattened renderable execution items for the current playground context.
 * Each item represents one row + executionId pair.
 */
export const renderableExecutionItemsAtom = atom<RenderableExecutionItem[]>((get) => {
    const rowIds = get(executionRowIdsAtom)
    const executionIds = get(displayedEntityIdsAtom)

    if (!Array.isArray(rowIds) || rowIds.length === 0) return []
    if (!Array.isArray(executionIds) || executionIds.length === 0) return []

    const items: RenderableExecutionItem[] = []
    for (let rowIndex = 0; rowIndex < rowIds.length; rowIndex++) {
        const rowId = rowIds[rowIndex]
        for (let executionIndex = 0; executionIndex < executionIds.length; executionIndex++) {
            const executionId = executionIds[executionIndex]
            items.push({
                key: `${rowId}:${executionId}`,
                rowId,
                executionId,
                rowIndex,
                executionIndex,
                isFirstRow: rowIndex === 0,
                isLastRow: rowIndex === rowIds.length - 1,
                isFirstExecution: executionIndex === 0,
                isLastExecution: executionIndex === executionIds.length - 1,
            })
        }
    }
    return items
})

/**
 * Renderable execution items grouped by row.
 */
export const renderableExecutionRowsAtom = atom<RenderableExecutionRow[]>((get) => {
    const rowIds = get(executionRowIdsAtom)
    const items = get(renderableExecutionItemsAtom)

    // Group items by rowId in a single pass
    const itemsByRow = new Map<string, RenderableExecutionItem[]>()
    for (const item of items) {
        const list = itemsByRow.get(item.rowId)
        if (list) {
            list.push(item)
        } else {
            itemsByRow.set(item.rowId, [item])
        }
    }

    return rowIds.map((rowId, rowIndex) => ({
        rowId,
        rowIndex,
        isFirstRow: rowIndex === 0,
        isLastRow: rowIndex === rowIds.length - 1,
        items: itemsByRow.get(rowId) ?? [],
    }))
})

/**
 * Renderable execution items scoped to a single row.
 */
export const renderableExecutionItemsByRowAtomFamily = atomFamily((rowId: string) =>
    atom((get) => get(renderableExecutionItemsAtom).filter((item) => item.rowId === rowId)),
)

/**
 * Renderable execution items scoped to a single execution ID (entity).
 */
export const renderableExecutionItemsByExecutionIdAtomFamily = atomFamily((executionId: string) =>
    atom((get) =>
        get(renderableExecutionItemsAtom).filter((item) => item.executionId === executionId),
    ),
)

/**
 * Deduplicated row IDs for a specific entity (execution) ID.
 *
 * When entityId is provided, filters renderable items to that entity and
 * extracts unique row IDs. When empty, falls back to the global executionRowIds.
 */
export const executionRowIdsForEntityAtomFamily = atomFamily((entityId: string) =>
    atom((get) => {
        if (!entityId) return get(executionRowIdsAtom) as string[]
        const items = get(renderableExecutionItemsByExecutionIdAtomFamily(entityId))
        const seen = new Set<string>()
        const ids: string[] = []
        for (const item of items) {
            if (!seen.has(item.rowId)) {
                seen.add(item.rowId)
                ids.push(item.rowId)
            }
        }
        return ids
    }),
)

// ============================================================================
// VARIABLE NAMES (derived from entity input ports)
// ============================================================================

/**
 * Unified variable names across all displayed entities.
 *
 * Reads input ports from each entity (revision) in the playground and
 * deduplicates by key. This is the single source of truth for which
 * variables exist — consumers should never store variable names separately.
 *
 * Variable names come from the runnable's input ports, which are derived
 * from the prompt template, tools, response_format, and schema.
 */
export const inputVariableNamesAtom = atom<string[]>((get) => {
    const nodes = get(playgroundNodesAtom).filter((n) => n.depth === 0)
    const seen = new Set<string>()
    const names: string[] = []
    for (const node of nodes) {
        const scoped = runnableBridge.forType(node.entityType)
        const ports = get(scoped.inputPorts(node.entityId)) as RunnablePort[]
        for (const port of ports || []) {
            if (port.key && !seen.has(port.key)) {
                seen.add(port.key)
                names.push(port.key)
            }
        }
    }
    return names
})

/**
 * Schema map for input variables.
 *
 * Maps each variable key to its RunnablePort type and full schema.
 * Used by VariableControlAdapter to render schema-aware controls
 * (e.g. JSON editor for object types, number input for numbers).
 */
export const inputPortSchemaMapAtom = atom<Record<string, {type: string; schema?: unknown}>>(
    (get) => {
        const nodes = get(playgroundNodesAtom).filter((n) => n.depth === 0)
        const map: Record<string, {type: string; schema?: unknown}> = {}
        for (const node of nodes) {
            const scoped = runnableBridge.forType(node.entityType)
            const ports = get(scoped.inputPorts(node.entityId)) as RunnablePort[]
            for (const port of ports || []) {
                if (port.key && !(port.key in map)) {
                    map[port.key] = {type: port.type, schema: port.schema}
                }
            }
        }
        return map
    },
)

// ============================================================================
// COMPARISON STATE (derived from playground nodes)
// ============================================================================

// ============================================================================
// VARIABLE MERGE (PropertyNode-aware)
// ============================================================================

// ============================================================================
// APP-LEVEL MODE SELECTORS
// ============================================================================

/**
 * App-level chat mode detection.
 *
 * Derives from the primary node's entity ID via `runnableBridge.executionMode`.
 * Returns `true` for chat apps, `false` for completion apps, `undefined` while loading.
 *
 */
export const isChatModeAtom = atom<boolean | undefined>((get) => {
    const rootNode = get(playgroundNodesAtom).find((n) => n.depth === 0)
    if (!rootNode) return undefined
    const scoped = runnableBridge.forType(rootNode.entityType)
    const mode = get(scoped.executionMode(rootNode.entityId))
    return mode === "chat"
})

/**
 * App-level type derived from chat mode.
 *
 * Returns `"chat"` or `"completion"` based on `isChatModeAtom`.
 * Returns `undefined` while entity data is loading.
 */
export type AppType = "chat" | "completion"

export const appTypeAtom = atom<AppType | undefined>((get) => {
    const isChat = get(isChatModeAtom)
    if (isChat === undefined) return undefined
    return isChat ? "chat" : "completion"
})

// ============================================================================
// ROW RUN STATUS
// ============================================================================

/**
 * Check if any entity is currently running for a given row ID.
 *
 * Checks execution lifecycle snapshots across all displayed entity IDs.
 * Used by chat and completion UI to disable/enable run buttons during execution.
 */
export const isAnyRunningForRowAtomFamily = atomFamily((rowId: string) =>
    atom((get) => {
        const loadableId = get(derivedLoadableIdAtom)
        if (!loadableId) return false
        const ids = get(entityIdsAtom)
        return ids.some((eid: string) => {
            const lifecycle = getExecutionItemLifecycleSnapshot(get, {
                loadableId,
                rowId,
                entityId: eid,
            })
            return Boolean(lifecycle?.isRunning)
        })
    }),
)

// ============================================================================
// RE-EXPORTS (for convenience)
// ============================================================================

// Re-export base selectors for direct access
export {
    executionModeAtomFamily,
    sessionsAtomFamily,
    activeSessionsAtomFamily,
    stepsAtomFamily,
    resultsForStepAtomFamily,
    resultAtomFamily,
    isStepRunningAtomFamily,
    isAnyExecutingAtomFamily,
    stepAtomFamily,
    sessionAtomFamily,
}
