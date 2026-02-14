/**
 * Execution Module Reducer Actions
 *
 * Write atoms for managing execution state lifecycle:
 * - Session management (init, add, remove, set active)
 * - Step management (add, update, remove)
 * - Run lifecycle (start, complete, fail, cancel)
 *
 * @module execution/reducer
 */

import {loadableController} from "@agenta/entities/runnable"
import {testcaseMolecule} from "@agenta/entities/testcase"
import {atom} from "jotai"

import {outputConnectionsAtom} from "../atoms"
import {playgroundNodesAtom, primaryNodeAtom} from "../atoms/playground"
import type {OutputConnection} from "../types"

import {
    executionStateAtomFamily,
    executionModeAtomFamily,
    sessionsByIdAtomFamily,
    activeSessionIdsAtomFamily,
    stepsByIdAtomFamily,
    stepIdsAtomFamily,
    resultsByKeyAtomFamily,
    buildResultKey,
    activeSessionsAtomFamily,
    executionConcurrencyAtom,
    repetitionCountAtom,
    repetitionIndexAtomFamily,
} from "./atoms"
import {createExecutionItemHandle} from "./executionItems"
import {runSessionsWithExecutionItems} from "./executionRunner"
import {derivedLoadableIdAtom} from "./selectors"
import type {
    ExecutionSession,
    ExecutionStep,
    RunResult,
    InitSessionsPayload,
    RunStepPayload,
    AddStepPayload,
    CancelStepPayload,
    ExecutionInput,
    SessionExecutionOptions,
} from "./types"

// ============================================================================
// SESSION ACTIONS
// ============================================================================

/**
 * Initialize execution sessions
 *
 * Replaces all existing sessions with the provided sessions.
 * Also sets all sessions as active by default.
 *
 * @example
 * const init = useSetAtom(initSessionsAtom)
 * init({
 *     loadableId: "loadable-1",
 *     sessions: [
 *         { id: "sess:rev1", runnableId: "rev1", runnableType: "appRevision", mode: "completion" }
 *     ]
 * })
 */
export const initSessionsAtom = atom(
    null,
    (get, set, payload: {loadableId: string} & InitSessionsPayload) => {
        const {loadableId, sessions} = payload
        const sessionsById: Record<string, ExecutionSession> = {}
        const activeSessionIds: string[] = []

        for (const session of sessions) {
            sessionsById[session.id] = session
            activeSessionIds.push(session.id)
        }

        set(sessionsByIdAtomFamily(loadableId), sessionsById)
        set(activeSessionIdsAtomFamily(loadableId), activeSessionIds)

        // Set mode from first session (all sessions should have same mode)
        if (sessions.length > 0) {
            set(executionModeAtomFamily(loadableId), sessions[0].mode)
        }
    },
)

/**
 * Add a single session
 *
 * @example
 * const addSession = useSetAtom(addSessionAtom)
 * addSession({
 *     loadableId: "loadable-1",
 *     session: { id: "sess:rev2", runnableId: "rev2", runnableType: "appRevision", mode: "completion" }
 * })
 */
export const addSessionAtom = atom(
    null,
    (get, set, payload: {loadableId: string; session: ExecutionSession}) => {
        const {loadableId, session} = payload
        const sessionsById = get(sessionsByIdAtomFamily(loadableId))
        const activeSessionIds = get(activeSessionIdsAtomFamily(loadableId))

        set(sessionsByIdAtomFamily(loadableId), {
            ...sessionsById,
            [session.id]: session,
        })

        // Add to active sessions if not already present
        if (!activeSessionIds.includes(session.id)) {
            set(activeSessionIdsAtomFamily(loadableId), [...activeSessionIds, session.id])
        }
    },
)

/**
 * Remove a session
 *
 * Removes the session and all its results.
 *
 * @example
 * const removeSession = useSetAtom(removeSessionAtom)
 * removeSession({ loadableId: "loadable-1", sessionId: "sess:rev1" })
 */
export const removeSessionAtom = atom(
    null,
    (get, set, payload: {loadableId: string; sessionId: string}) => {
        const {loadableId, sessionId} = payload
        const sessionsById = {...get(sessionsByIdAtomFamily(loadableId))}
        const activeSessionIds = get(activeSessionIdsAtomFamily(loadableId))
        const resultsByKey = {...get(resultsByKeyAtomFamily(loadableId))}

        // Remove session
        delete sessionsById[sessionId]
        set(sessionsByIdAtomFamily(loadableId), sessionsById)

        // Remove from active sessions
        set(
            activeSessionIdsAtomFamily(loadableId),
            activeSessionIds.filter((id) => id !== sessionId),
        )

        // Remove all results for this session
        for (const key of Object.keys(resultsByKey)) {
            if (key.endsWith(`:${sessionId}`)) {
                delete resultsByKey[key]
            }
        }
        set(resultsByKeyAtomFamily(loadableId), resultsByKey)
    },
)

/**
 * Set active sessions (for compare mode)
 *
 * @example
 * const setActive = useSetAtom(setActiveSessionsAtom)
 * setActive({ loadableId: "loadable-1", sessionIds: ["sess:rev1", "sess:rev2"] })
 */
export const setActiveSessionsAtom = atom(
    null,
    (get, set, payload: {loadableId: string; sessionIds: string[]}) => {
        const {loadableId, sessionIds} = payload
        set(activeSessionIdsAtomFamily(loadableId), sessionIds)
    },
)

// ============================================================================
// STEP ACTIONS
// ============================================================================

/**
 * Generate a unique step ID
 */
function generateStepId(): string {
    return `step-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
}

/**
 * Add a step (primarily for chat mode)
 *
 * @example
 * const addStep = useSetAtom(addStepAtom)
 * addStep({
 *     loadableId: "loadable-1",
 *     input: { kind: "chat", role: "user", content: "Hello!" }
 * })
 */
export const addStepAtom = atom(
    null,
    (get, set, payload: {loadableId: string} & AddStepPayload): string => {
        const {loadableId, input, id} = payload
        const stepsById = get(stepsByIdAtomFamily(loadableId))
        const stepIds = get(stepIdsAtomFamily(loadableId))

        const stepId = id ?? generateStepId()
        const step: ExecutionStep = {
            id: stepId,
            input,
            createdAt: Date.now(),
        }

        set(stepsByIdAtomFamily(loadableId), {...stepsById, [stepId]: step})
        set(stepIdsAtomFamily(loadableId), [...stepIds, stepId])

        return stepId
    },
)

/**
 * Update step input (for editing before execution)
 *
 * @example
 * const updateStep = useSetAtom(updateStepInputAtom)
 * updateStep({
 *     loadableId: "loadable-1",
 *     stepId: "step-123",
 *     input: { kind: "chat", role: "user", content: "Updated content" }
 * })
 */
export const updateStepInputAtom = atom(
    null,
    (get, set, payload: {loadableId: string; stepId: string; input: ExecutionInput}) => {
        const {loadableId, stepId, input} = payload
        const stepsById = {...get(stepsByIdAtomFamily(loadableId))}

        if (stepsById[stepId]) {
            stepsById[stepId] = {...stepsById[stepId], input}
            set(stepsByIdAtomFamily(loadableId), stepsById)
        }
    },
)

/**
 * Remove a step and its results
 *
 * @example
 * const removeStep = useSetAtom(removeStepAtom)
 * removeStep({ loadableId: "loadable-1", stepId: "step-123" })
 */
export const removeStepAtom = atom(
    null,
    (get, set, payload: {loadableId: string; stepId: string}) => {
        const {loadableId, stepId} = payload
        const stepsById = {...get(stepsByIdAtomFamily(loadableId))}
        const stepIds = get(stepIdsAtomFamily(loadableId))
        const resultsByKey = {...get(resultsByKeyAtomFamily(loadableId))}

        // Remove step
        delete stepsById[stepId]
        set(stepsByIdAtomFamily(loadableId), stepsById)

        // Remove from step IDs
        set(
            stepIdsAtomFamily(loadableId),
            stepIds.filter((id) => id !== stepId),
        )

        // Remove all results for this step
        for (const key of Object.keys(resultsByKey)) {
            if (key.startsWith(`${stepId}:`)) {
                delete resultsByKey[key]
            }
        }
        set(resultsByKeyAtomFamily(loadableId), resultsByKey)
    },
)

// ============================================================================
// RUN LIFECYCLE ACTIONS
// ============================================================================

/**
 * Start a run for a specific step and session
 *
 * Sets the result to "running" status.
 */
export const startRunAtom = atom(
    null,
    (get, set, payload: {loadableId: string; stepId: string; sessionId: string; runId: string}) => {
        const {loadableId, stepId, sessionId, runId} = payload
        const resultsByKey = {...get(resultsByKeyAtomFamily(loadableId))}
        const key = buildResultKey(stepId, sessionId)

        resultsByKey[key] = {
            status: "running",
            sessionId,
            runId,
            startedAt: Date.now(),
        }

        set(resultsByKeyAtomFamily(loadableId), resultsByKey)
    },
)

/**
 * Complete a run successfully
 */
export const completeRunAtom = atom(
    null,
    (
        get,
        set,
        payload: {
            loadableId: string
            stepId: string
            sessionId: string
            result: Partial<RunResult>
        },
    ) => {
        const {loadableId, stepId, sessionId, result} = payload
        const resultsByKey = {...get(resultsByKeyAtomFamily(loadableId))}
        const key = buildResultKey(stepId, sessionId)
        const existing = resultsByKey[key] ?? {sessionId, status: "idle" as const}

        resultsByKey[key] = {
            ...existing,
            ...result,
            status: "success",
            completedAt: Date.now(),
        }

        set(resultsByKeyAtomFamily(loadableId), resultsByKey)
    },
)

/**
 * Fail a run with error
 */
export const failRunAtom = atom(
    null,
    (
        get,
        set,
        payload: {
            loadableId: string
            stepId: string
            sessionId: string
            error: {message: string; code?: string}
        },
    ) => {
        const {loadableId, stepId, sessionId, error} = payload
        const resultsByKey = {...get(resultsByKeyAtomFamily(loadableId))}
        const key = buildResultKey(stepId, sessionId)
        const existing = resultsByKey[key] ?? {sessionId, status: "idle" as const}

        resultsByKey[key] = {
            ...existing,
            status: "error",
            error,
            completedAt: Date.now(),
        }

        set(resultsByKeyAtomFamily(loadableId), resultsByKey)
    },
)

/**
 * Cancel a run
 *
 * Aborts the in-flight HTTP request (via AbortController) and sets
 * the result status to "cancelled". Also calls adapter.cancel() if provided.
 */
export const cancelRunAtom = atom(
    null,
    (get, set, payload: {loadableId: string; stepId: string; sessionId: string}) => {
        const {loadableId, stepId, sessionId} = payload
        const revisionId = sessionId.startsWith("sess:") ? sessionId.slice(5) : sessionId
        const handle = createExecutionItemHandle({
            loadableId,
            rowId: stepId,
            revisionId,
        })
        handle.cancel({get, set})
    },
)

/**
 * Update chain progress during execution
 */
export const updateChainProgressAtom = atom(
    null,
    (
        get,
        set,
        payload: {
            loadableId: string
            stepId: string
            sessionId: string
            chainProgress: RunResult["chainProgress"]
            chainResults?: RunResult["chainResults"]
        },
    ) => {
        const {loadableId, stepId, sessionId, chainProgress, chainResults} = payload
        const resultsByKey = {...get(resultsByKeyAtomFamily(loadableId))}
        const key = buildResultKey(stepId, sessionId)
        const existing = resultsByKey[key]

        if (existing) {
            resultsByKey[key] = {
                ...existing,
                chainProgress,
                ...(chainResults !== undefined ? {chainResults} : {}),
            }
            set(resultsByKeyAtomFamily(loadableId), resultsByKey)
        }
    },
)

/**
 * Run a step across sessions
 *
 * This is the main execution action that supports multi-session compare mode.
 * It executes the step for each active session (or specified sessions) in parallel,
 * limited by executionConcurrencyAtom (default 6).
 *
 * @example
 * const runStep = useSetAtom(runStepAtom)
 * await runStep({
 *     loadableId: "loadable-1",
 *     stepId: "row-123",
 *     data: { prompt: "Hello" }
 * })
 */
export const runStepAtom = atom(
    null,
    async (get, set, payload: {loadableId: string} & RunStepPayload) => {
        const {
            loadableId,
            stepId,
            sessionIds: specifiedSessionIds,
            data = {},
            sessionOptions,
        } = payload

        const primaryNode = get(primaryNodeAtom)
        if (!primaryNode) return

        const nodes = get(playgroundNodesAtom)
        const allConnections = get(outputConnectionsAtom) as OutputConnection[]
        const activeSessions = get(activeSessionsAtomFamily(loadableId))

        // Use specified sessions or all active sessions
        const sessionsToRun = specifiedSessionIds
            ? activeSessions.filter((s) => specifiedSessionIds.includes(s.id))
            : activeSessions

        if (sessionsToRun.length === 0) return

        // Read repetition count (disabled in compare mode — multiple sessions)
        const rawRepetitions = get(repetitionCountAtom)
        const repetitions = sessionsToRun.length > 1 ? 1 : rawRepetitions

        await runSessionsWithExecutionItems({
            get,
            set,
            loadableId,
            stepId,
            sessions: sessionsToRun,
            data,
            nodes,
            primaryNode,
            allConnections,
            sessionOptions,
            repetitionCount: repetitions,
            concurrency: get(executionConcurrencyAtom),
            createLifecycle: (session) => ({
                onStart: ({runId}) => {
                    set(startRunAtom, {loadableId, stepId, sessionId: session.id, runId})
                },
                onProgress: ({chainProgress, chainResults}) => {
                    set(updateChainProgressAtom, {
                        loadableId,
                        stepId,
                        sessionId: session.id,
                        chainProgress,
                        chainResults,
                    })
                },
                onComplete: ({result}) => {
                    set(completeRunAtom, {
                        loadableId,
                        stepId,
                        sessionId: session.id,
                        result,
                    })
                },
                onFail: ({error}) => {
                    set(failRunAtom, {loadableId, stepId, sessionId: session.id, error})
                },
                onCancel: () => {
                    set(cancelRunAtom, {loadableId, stepId, sessionId: session.id})
                },
            }),
        })
    },
)

/**
 * Cancel a step for sessions
 *
 * @example
 * const cancelStep = useSetAtom(cancelStepAtom)
 * cancelStep({ loadableId: "loadable-1", stepId: "step-123" })
 */
export const cancelStepAtom = atom(
    null,
    (get, set, payload: {loadableId: string} & CancelStepPayload) => {
        const {loadableId, stepId, sessionIds} = payload
        const activeSessions = get(activeSessionsAtomFamily(loadableId))

        const sessionsToCancel = sessionIds
            ? activeSessions.filter((s) => sessionIds.includes(s.id))
            : activeSessions

        for (const session of sessionsToCancel) {
            set(cancelRunAtom, {loadableId, stepId, sessionId: session.id})
        }
    },
)

/**
 * Reset execution state
 *
 * Clears all sessions, steps, and results.
 *
 * @example
 * const reset = useSetAtom(resetExecutionAtom)
 * reset({ loadableId: "loadable-1" })
 */
export const resetExecutionAtom = atom(null, (get, set, payload: {loadableId: string}) => {
    const {loadableId} = payload
    const initialMode = get(executionModeAtomFamily(loadableId))

    set(executionStateAtomFamily(loadableId), {
        mode: initialMode,
        sessionsById: {},
        activeSessionIds: [],
        stepsById: {},
        stepIds: [],
        resultsByKey: {},
    })
})

// ============================================================================
// CONTEXT-AWARE ACTIONS (auto-inject loadableId from primary node)
// ============================================================================

/**
 * Context-aware payload for runStep (without loadableId)
 */
export interface RunStepWithContextPayload {
    /** The step ID (rowId for completion mode) */
    stepId: string
    /** Input data for the step */
    data?: Record<string, unknown>
    /** Optional specific session IDs (defaults to all active) */
    sessionIds?: string[]
    /** Per-session options passed through to the adapter. Keyed by sessionId. */
    sessionOptions?: Record<string, SessionExecutionOptions>
}

/**
 * Run a step with automatic loadableId derivation from primary node
 *
 * This is the recommended action for most use cases. It automatically
 * derives the loadableId from the primary node, eliminating the need
 * for callers to construct it manually.
 *
 * @example
 * const runStep = useSetAtom(runStepWithContextAtom)
 * await runStep({ stepId: "row-123", data: { prompt: "Hello" } })
 */
export const runStepWithContextAtom = atom(
    null,
    async (get, set, payload: RunStepWithContextPayload) => {
        const loadableId = get(derivedLoadableIdAtom)

        if (!loadableId) {
            console.warn("runStepWithContext: No primary node available")
            return
        }

        await set(runStepAtom, {
            loadableId,
            ...payload,
        })
    },
)

/**
 * Initialize sessions with automatic loadableId derivation
 *
 * @example
 * const initSessions = useSetAtom(initSessionsWithContextAtom)
 * initSessions({
 *     sessions: [
 *         { id: "sess:rev1", runnableId: "rev1", runnableType: "appRevision", mode: "completion" }
 *     ]
 * })
 */
export const initSessionsWithContextAtom = atom(null, (get, set, payload: InitSessionsPayload) => {
    const loadableId = get(derivedLoadableIdAtom)

    if (!loadableId) {
        console.warn("initSessionsWithContext: No primary node available")
        return
    }

    set(initSessionsAtom, {loadableId, ...payload})
})

/**
 * Cancel a step with automatic loadableId derivation
 *
 * @example
 * const cancelStep = useSetAtom(cancelStepWithContextAtom)
 * cancelStep({ stepId: "step-123" })
 */
export const cancelStepWithContextAtom = atom(null, (get, set, payload: CancelStepPayload) => {
    const loadableId = get(derivedLoadableIdAtom)

    if (!loadableId) {
        console.warn("cancelStepWithContext: No primary node available")
        return
    }

    set(cancelStepAtom, {loadableId, ...payload})
})

/**
 * Reset execution with automatic loadableId derivation
 *
 * @example
 * const reset = useSetAtom(resetExecutionWithContextAtom)
 * reset()
 */
export const resetExecutionWithContextAtom = atom(null, (get, set) => {
    const loadableId = get(derivedLoadableIdAtom)

    if (!loadableId) {
        console.warn("resetExecutionWithContext: No primary node available")
        return
    }

    set(resetExecutionAtom, {loadableId})
})

/**
 * Set global repetition count.
 * Value is clamped to [1, 10] to match UI limits.
 */
export const setRepetitionCountAtom = atom(null, (_get, set, count: number) => {
    const numericCount = Number.isFinite(count) ? Math.trunc(count) : 1
    const nextCount = Math.min(10, Math.max(1, numericCount))
    set(repetitionCountAtom, nextCount)
})

/**
 * Set repetition index for a row+entity pair.
 * Value is clamped to >= 0.
 */
export const setRepetitionIndexAtom = atom(
    null,
    (
        _get,
        set,
        payload: {
            rowId: string
            entityId: string
            index: number
        },
    ) => {
        const numericIndex = Number.isFinite(payload.index) ? Math.trunc(payload.index) : 0
        const key = `${payload.rowId}:${payload.entityId}`
        set(repetitionIndexAtomFamily(key), Math.max(0, numericIndex))
    },
)

/**
 * Clear stored execution output for a specific row+revision using context-derived loadableId.
 * Useful when chat assistant output is manually removed from UI.
 */
export const clearResponseByRowRevisionWithContextAtom = atom(
    null,
    (
        get,
        set,
        payload: {
            rowId: string
            revisionId: string
        },
    ) => {
        const loadableId = get(derivedLoadableIdAtom)
        if (!loadableId) return

        const key = buildResultKey(payload.rowId, `sess:${payload.revisionId}`)
        const resultsByKey = {...get(resultsByKeyAtomFamily(loadableId))}
        const existing = resultsByKey[key]
        if (!existing) return

        resultsByKey[key] = {
            ...existing,
            status: "idle",
            output: null,
            error: undefined,
            traceId: undefined,
            resultHash: null,
        }

        set(resultsByKeyAtomFamily(loadableId), resultsByKey)
    },
)

// ============================================================================
// ROW MUTATION ACTIONS (context-aware wrappers around loadableController)
// ============================================================================

/**
 * Add a row with automatic loadableId derivation.
 *
 * @example
 * const addRow = useSetAtom(addRowWithContextAtom)
 * addRow({ input: "test" })
 */
export const addRowWithContextAtom = atom(null, (get, set, data?: Record<string, unknown>) => {
    const loadableId = get(derivedLoadableIdAtom)
    if (!loadableId) return null
    return set(loadableController.actions.addRow, loadableId, data) ?? null
})

/**
 * Remove a row with automatic loadableId derivation.
 *
 * @example
 * const deleteRow = useSetAtom(deleteRowWithContextAtom)
 * deleteRow("row-123")
 */
export const deleteRowWithContextAtom = atom(null, (get, set, rowId: string) => {
    const loadableId = get(derivedLoadableIdAtom)
    if (!loadableId) return
    set(loadableController.actions.removeRow, loadableId, rowId)
})

/**
 * Duplicate a row with automatic loadableId derivation.
 * Reads the source row's data and creates a new row with the same values.
 *
 * @example
 * const duplicateRow = useSetAtom(duplicateRowWithContextAtom)
 * duplicateRow("row-123")
 */
export const duplicateRowWithContextAtom = atom(null, (get, set, sourceRowId: string) => {
    const loadableId = get(derivedLoadableIdAtom)
    if (!loadableId) return null

    const rows = get(loadableController.selectors.rows(loadableId))
    const source = rows.find((row) => row.id === sourceRowId)
    if (!source) return null

    return set(loadableController.actions.addRow, loadableId, {...source.data}) ?? null
})

/**
 * Update a single row value with automatic loadableId derivation.
 *
 * @example
 * const setRowValue = useSetAtom(setRowValueWithContextAtom)
 * setRowValue({ rowId: "row-123", key: "input", value: "new value" })
 */
export const setRowValueWithContextAtom = atom(
    null,
    (get, set, payload: {rowId: string; key: string; value: string}) => {
        const loadableId = get(derivedLoadableIdAtom)
        if (!loadableId) return
        set(loadableController.actions.updateRow, loadableId, payload.rowId, {
            [payload.key]: payload.value,
        })
    },
)

/**
 * Direct testcase cell update — writes a single field to the testcase entity.
 *
 * Uses testcaseMolecule.actions.update which applies changes to the testcase's
 * `data` property and handles dirty tracking automatically.
 *
 * This bypasses the loadable layer indirection:
 *   OLD: setRowValueWithContext → loadableController.actions.updateRow → testcaseMolecule.actions.update
 *   NEW: testcaseMolecule.actions.update(id, {data: {[column]: value}}) — direct
 *
 * @example
 * const setCellValue = useSetAtom(setTestcaseCellValueAtom)
 * setCellValue({ testcaseId: "tc-123", column: "input", value: "new value" })
 */
export const setTestcaseCellValueAtom = atom(
    null,
    (_get, set, payload: {testcaseId: string; column: string; value: string}) => {
        if (!payload.testcaseId || !payload.column) return
        set(testcaseMolecule.actions.update, payload.testcaseId, {
            data: {[payload.column]: payload.value},
        })
    },
)
