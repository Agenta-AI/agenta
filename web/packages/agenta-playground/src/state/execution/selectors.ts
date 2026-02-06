/**
 * Execution Module Selectors
 *
 * Higher-level derived selectors for common execution state queries.
 * These build on the base atoms to provide convenient access patterns.
 *
 * @module execution/selectors
 */

import {atom} from "jotai"
import {atomFamily} from "jotai/utils"

import {primaryNodeAtom} from "../atoms/playground"

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
    const primaryNode = get(primaryNodeAtom)
    if (!primaryNode) return ""
    return `testset:${primaryNode.entityType}:${primaryNode.entityId}`
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
// COMBINED SELECTORS
// ============================================================================

/**
 * Get full execution state summary for UI
 *
 * @param loadableId - The loadable instance ID
 * @returns Atom for complete execution state summary
 */
export const executionStateSummaryAtomFamily = atomFamily((loadableId: string) =>
    atom((get) => {
        const mode = get(executionModeAtomFamily(loadableId))
        const sessions = get(sessionsAtomFamily(loadableId))
        const activeSessions = get(activeSessionsAtomFamily(loadableId))
        const steps = get(stepsAtomFamily(loadableId))
        const isAnyExecuting = get(isAnyExecutingAtomFamily(loadableId))
        const progress = get(executionProgressAtomFamily(loadableId))

        return {
            mode,
            sessionCount: sessions.length,
            activeSessionCount: activeSessions.length,
            isCompareMode: activeSessions.length > 1,
            stepCount: steps.length,
            isExecuting: isAnyExecuting,
            progress,
        }
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
