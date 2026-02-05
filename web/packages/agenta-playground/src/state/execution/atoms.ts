/**
 * Execution Module Atoms
 *
 * Core Jotai atoms for multi-session execution state.
 * These atoms provide the primitive state storage for sessions, steps, and results.
 *
 * @module execution/atoms
 */

import {atom} from "jotai"
import {atomFamily} from "jotai/utils"

import type {
    ExecutionMode,
    ExecutionSession,
    ExecutionStep,
    RunResult,
    ExecutionState,
} from "./types"
import {createInitialExecutionState} from "./types"

// ============================================================================
// EXECUTION STATE ATOM FAMILY
// ============================================================================

/**
 * Per-loadable execution state atom family
 *
 * Each loadable instance has its own execution state to support
 * independent playground instances.
 *
 * @param loadableId - The loadable instance ID
 * @returns Atom containing the execution state for this loadable
 *
 * @example
 * const executionState = useAtomValue(executionStateAtomFamily(loadableId))
 */
export const executionStateAtomFamily = atomFamily((loadableId: string) =>
    atom<ExecutionState>(createInitialExecutionState()),
)

// ============================================================================
// MODE ATOM
// ============================================================================

/**
 * Execution mode atom family
 *
 * Determines whether execution is in completion or chat mode.
 *
 * @param loadableId - The loadable instance ID
 * @returns Atom for the execution mode
 *
 * @example
 * const mode = useAtomValue(executionModeAtomFamily(loadableId))
 * // "completion" | "chat"
 */
export const executionModeAtomFamily = atomFamily((loadableId: string) =>
    atom(
        (get) => get(executionStateAtomFamily(loadableId)).mode,
        (get, set, mode: ExecutionMode) => {
            const state = get(executionStateAtomFamily(loadableId))
            set(executionStateAtomFamily(loadableId), {...state, mode})
        },
    ),
)

// ============================================================================
// SESSION ATOMS
// ============================================================================

/**
 * Sessions by ID atom family
 *
 * @param loadableId - The loadable instance ID
 * @returns Atom for the sessions by ID map
 */
export const sessionsByIdAtomFamily = atomFamily((loadableId: string) =>
    atom(
        (get) => get(executionStateAtomFamily(loadableId)).sessionsById,
        (get, set, sessionsById: Record<string, ExecutionSession>) => {
            const state = get(executionStateAtomFamily(loadableId))
            set(executionStateAtomFamily(loadableId), {...state, sessionsById})
        },
    ),
)

/**
 * Active session IDs atom family
 *
 * @param loadableId - The loadable instance ID
 * @returns Atom for the active session IDs array
 */
export const activeSessionIdsAtomFamily = atomFamily((loadableId: string) =>
    atom(
        (get) => get(executionStateAtomFamily(loadableId)).activeSessionIds,
        (get, set, activeSessionIds: string[]) => {
            const state = get(executionStateAtomFamily(loadableId))
            set(executionStateAtomFamily(loadableId), {...state, activeSessionIds})
        },
    ),
)

/**
 * All sessions as array atom family
 *
 * Derived atom that returns all sessions as an array.
 *
 * @param loadableId - The loadable instance ID
 * @returns Atom for all sessions as array
 *
 * @example
 * const sessions = useAtomValue(sessionsAtomFamily(loadableId))
 */
export const sessionsAtomFamily = atomFamily((loadableId: string) =>
    atom((get) => {
        const sessionsById = get(sessionsByIdAtomFamily(loadableId))
        return Object.values(sessionsById)
    }),
)

/**
 * Active sessions atom family
 *
 * Derived atom that returns only the active sessions.
 *
 * @param loadableId - The loadable instance ID
 * @returns Atom for active sessions array
 *
 * @example
 * const activeSessions = useAtomValue(activeSessionsAtomFamily(loadableId))
 */
export const activeSessionsAtomFamily = atomFamily((loadableId: string) =>
    atom((get) => {
        const sessionsById = get(sessionsByIdAtomFamily(loadableId))
        const activeIds = get(activeSessionIdsAtomFamily(loadableId))
        return activeIds.map((id) => sessionsById[id]).filter(Boolean)
    }),
)

/**
 * Single session atom family
 *
 * @param params - Object with loadableId and sessionId
 * @returns Atom for a single session
 */
export const sessionAtomFamily = atomFamily(
    ({loadableId, sessionId}: {loadableId: string; sessionId: string}) =>
        atom((get) => {
            const sessionsById = get(sessionsByIdAtomFamily(loadableId))
            return sessionsById[sessionId] ?? null
        }),
)

// ============================================================================
// STEP ATOMS
// ============================================================================

/**
 * Steps by ID atom family
 *
 * @param loadableId - The loadable instance ID
 * @returns Atom for the steps by ID map
 */
export const stepsByIdAtomFamily = atomFamily((loadableId: string) =>
    atom(
        (get) => get(executionStateAtomFamily(loadableId)).stepsById,
        (get, set, stepsById: Record<string, ExecutionStep>) => {
            const state = get(executionStateAtomFamily(loadableId))
            set(executionStateAtomFamily(loadableId), {...state, stepsById})
        },
    ),
)

/**
 * Step IDs atom family (ordered)
 *
 * @param loadableId - The loadable instance ID
 * @returns Atom for the step IDs array
 */
export const stepIdsAtomFamily = atomFamily((loadableId: string) =>
    atom(
        (get) => get(executionStateAtomFamily(loadableId)).stepIds,
        (get, set, stepIds: string[]) => {
            const state = get(executionStateAtomFamily(loadableId))
            set(executionStateAtomFamily(loadableId), {...state, stepIds})
        },
    ),
)

/**
 * All steps as array atom family (ordered by creation)
 *
 * @param loadableId - The loadable instance ID
 * @returns Atom for all steps in order
 *
 * @example
 * const steps = useAtomValue(stepsAtomFamily(loadableId))
 */
export const stepsAtomFamily = atomFamily((loadableId: string) =>
    atom((get) => {
        const stepsById = get(stepsByIdAtomFamily(loadableId))
        const stepIds = get(stepIdsAtomFamily(loadableId))
        return stepIds.map((id) => stepsById[id]).filter(Boolean)
    }),
)

/**
 * Single step atom family
 *
 * @param params - Object with loadableId and stepId
 * @returns Atom for a single step
 */
export const stepAtomFamily = atomFamily(
    ({loadableId, stepId}: {loadableId: string; stepId: string}) =>
        atom((get) => {
            const stepsById = get(stepsByIdAtomFamily(loadableId))
            return stepsById[stepId] ?? null
        }),
)

// ============================================================================
// RESULT ATOMS
// ============================================================================

/**
 * Results by key atom family
 *
 * Results are stored with composite key: "${stepId}:${sessionId}"
 *
 * @param loadableId - The loadable instance ID
 * @returns Atom for results by key map
 */
export const resultsByKeyAtomFamily = atomFamily((loadableId: string) =>
    atom(
        (get) => get(executionStateAtomFamily(loadableId)).resultsByKey,
        (get, set, resultsByKey: Record<string, RunResult>) => {
            const state = get(executionStateAtomFamily(loadableId))
            set(executionStateAtomFamily(loadableId), {...state, resultsByKey})
        },
    ),
)

/**
 * Build composite key for result lookup
 */
export function buildResultKey(stepId: string, sessionId: string): string {
    return `${stepId}:${sessionId}`
}

/**
 * Results for a step atom family
 *
 * Returns all session results for a given step.
 *
 * @param params - Object with loadableId and stepId
 * @returns Atom for step results keyed by sessionId
 *
 * @example
 * const resultsForStep = useAtomValue(resultsForStepAtomFamily({ loadableId, stepId }))
 * // { "sess:rev1": RunResult, "sess:rev2": RunResult }
 */
export const resultsForStepAtomFamily = atomFamily(
    ({loadableId, stepId}: {loadableId: string; stepId: string}) =>
        atom((get) => {
            const resultsByKey = get(resultsByKeyAtomFamily(loadableId))
            const activeSessionIds = get(activeSessionIdsAtomFamily(loadableId))

            const results: Record<string, RunResult> = {}
            for (const sessionId of activeSessionIds) {
                const key = buildResultKey(stepId, sessionId)
                if (resultsByKey[key]) {
                    results[sessionId] = resultsByKey[key]
                }
            }
            return results
        }),
)

/**
 * Single result atom family
 *
 * @param params - Object with loadableId, stepId, and sessionId
 * @returns Atom for a single result
 *
 * @example
 * const result = useAtomValue(resultAtomFamily({ loadableId, stepId, sessionId }))
 */
export const resultAtomFamily = atomFamily(
    ({loadableId, stepId, sessionId}: {loadableId: string; stepId: string; sessionId: string}) =>
        atom((get) => {
            const resultsByKey = get(resultsByKeyAtomFamily(loadableId))
            const key = buildResultKey(stepId, sessionId)
            return resultsByKey[key] ?? null
        }),
)

/**
 * Check if a step is currently running (any session)
 *
 * @param params - Object with loadableId and stepId
 * @returns Atom that returns true if any session is running for this step
 *
 * @example
 * const isRunning = useAtomValue(isStepRunningAtomFamily({ loadableId, stepId }))
 */
export const isStepRunningAtomFamily = atomFamily(
    ({loadableId, stepId}: {loadableId: string; stepId: string}) =>
        atom((get) => {
            const resultsForStep = get(resultsForStepAtomFamily({loadableId, stepId}))
            return Object.values(resultsForStep).some(
                (r) => r.status === "running" || r.status === "pending",
            )
        }),
)

/**
 * Check if any execution is running for a loadable
 *
 * @param loadableId - The loadable instance ID
 * @returns Atom that returns true if any execution is running
 *
 * @example
 * const isExecuting = useAtomValue(isAnyExecutingAtomFamily(loadableId))
 */
export const isAnyExecutingAtomFamily = atomFamily((loadableId: string) =>
    atom((get) => {
        const resultsByKey = get(resultsByKeyAtomFamily(loadableId))
        return Object.values(resultsByKey).some(
            (r) => r.status === "running" || r.status === "pending",
        )
    }),
)
