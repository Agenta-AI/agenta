/**
 * Execution Controller
 *
 * Provides session-aware execution management for single and multi-session scenarios.
 * All execution orchestration logic lives here, not in React hooks.
 *
 * ## Usage
 *
 * ### Single Session Execution
 *
 * ```typescript
 * import { executionController } from '@agenta/playground'
 * import { useAtomValue, useSetAtom } from 'jotai'
 *
 * // Initialize a single session
 * const initSessions = useSetAtom(executionController.actions.initSessions)
 * initSessions({
 *     loadableId: "loadable-1",
 *     sessions: [
 *         { id: "sess:rev1", runnableId: "rev1", runnableType: "appRevision", mode: "completion" }
 *     ]
 * })
 *
 * // Run a step (row)
 * const runStep = useSetAtom(executionController.actions.runStep)
 * await runStep({ loadableId: "loadable-1", stepId: "row-123", data: { prompt: "Hello" } })
 *
 * // Get results
 * const result = useAtomValue(
 *     executionController.selectors.resultForStepSession("loadable-1", "row-123", "sess:rev1")
 * )
 * ```
 *
 * ### Multi-Session Execution (Compare Mode)
 *
 * ```typescript
 * import { executionController } from '@agenta/playground'
 *
 * // Initialize multiple sessions
 * const initSessions = useSetAtom(executionController.actions.initSessions)
 * initSessions({
 *     loadableId: "loadable-1",
 *     sessions: [
 *         { id: "sess:revA", runnableId: "revA", runnableType: "appRevision", mode: "completion" },
 *         { id: "sess:revB", runnableId: "revB", runnableType: "appRevision", mode: "completion" },
 *     ]
 * })
 *
 * // Run step across all active sessions
 * const runStep = useSetAtom(executionController.actions.runStep)
 * await runStep({ loadableId: "loadable-1", stepId: "row-123", data: { prompt: "Hello" } })
 *
 * // Get results per session
 * const resultsForStep = useAtomValue(
 *     executionController.selectors.resultsForStep("loadable-1", "row-123")
 * )
 * // { "sess:revA": RunResult, "sess:revB": RunResult }
 *
 * // Check if in compare mode
 * const isCompareMode = useAtomValue(
 *     executionController.selectors.isCompareMode("loadable-1")
 * )
 * ```
 */

import type {EntitySelection} from "@agenta/entities/runnable"

import {
    // Types
    type ExecutionSession,
    type ExecutionStep,
    type RunResult,
    type ExecutionMode,
    type InitSessionsPayload,
    type RunStepPayload,
    type AddStepPayload,
    type CancelStepPayload,
    type RunStepWithContextPayload,
    // Selectors (parameterized)
    executionModeAtomFamily,
    sessionsAtomFamily,
    activeSessionsAtomFamily,
    stepsAtomFamily,
    resultsForStepAtomFamily,
    resultAtomFamily,
    isStepRunningAtomFamily,
    isAnyExecutingAtomFamily,
    isCompareModeAtomFamily,
    executionProgressAtomFamily,
    executionStateSummaryAtomFamily,
    // Context selectors (derived from primary node)
    derivedLoadableIdAtom,
    activeSessionsWithContextAtom,
    isCompareModeWithContextAtom,
    isAnyExecutingWithContextAtom,
    executionProgressWithContextAtom,
    // Actions (parameterized)
    initSessionsAtom,
    addSessionAtom,
    removeSessionAtom,
    setActiveSessionsAtom,
    addStepAtom,
    updateStepInputAtom,
    removeStepAtom,
    runStepAtom,
    cancelStepAtom,
    resetExecutionAtom,
    // Context-aware actions (auto-inject loadableId)
    runStepWithContextAtom,
    initSessionsWithContextAtom,
    cancelStepWithContextAtom,
    resetExecutionWithContextAtom,
} from "../execution"

// ============================================================================
// TYPES
// ============================================================================

export interface RunnableNode {
    id: string
    entity: EntitySelection
    depth: number
}

// ============================================================================
// CONTROLLER EXPORT
// ============================================================================

export const executionController = {
    /**
     * Selectors - functions that return atoms
     */
    selectors: {
        // ----------------------------------------------------------------
        // Context-aware selectors (derived from primary node)
        // ----------------------------------------------------------------

        /**
         * Derived loadableId from primary node
         *
         * Use this when you don't have an explicit loadableId.
         * Format: "testset:{entityType}:{entityId}"
         *
         * @returns Atom for the derived loadableId
         */
        derivedLoadableId: derivedLoadableIdAtom,

        /**
         * Active sessions using derived loadableId
         *
         * @returns Atom for active sessions (derived from primary node)
         */
        activeSessionsWithContext: activeSessionsWithContextAtom,

        /**
         * Is compare mode using derived loadableId
         *
         * @returns Atom that returns true if comparing (derived from primary node)
         */
        isCompareModeWithContext: isCompareModeWithContextAtom,

        /**
         * Is any executing using derived loadableId
         *
         * @returns Atom that returns true if executing (derived from primary node)
         */
        isAnyExecutingWithContext: isAnyExecutingWithContextAtom,

        /**
         * Execution progress using derived loadableId
         *
         * @returns Atom for progress info (derived from primary node)
         */
        progressWithContext: executionProgressWithContextAtom,

        // ----------------------------------------------------------------
        // Parameterized selectors (require explicit loadableId)
        // ----------------------------------------------------------------

        /**
         * Get the execution mode for a loadable
         * @param loadableId - The loadable instance ID
         * @returns Atom for execution mode ("completion" | "chat")
         */
        mode: (loadableId: string) => executionModeAtomFamily(loadableId),

        /**
         * Get all sessions for a loadable
         * @param loadableId - The loadable instance ID
         * @returns Atom for all sessions as array
         */
        sessions: (loadableId: string) => sessionsAtomFamily(loadableId),

        /**
         * Get active sessions for a loadable (for compare mode)
         * @param loadableId - The loadable instance ID
         * @returns Atom for active sessions as array
         */
        activeSessions: (loadableId: string) => activeSessionsAtomFamily(loadableId),

        /**
         * Check if in compare mode (multiple active sessions)
         * @param loadableId - The loadable instance ID
         * @returns Atom that returns true if comparing
         */
        isCompareMode: (loadableId: string) => isCompareModeAtomFamily(loadableId),

        /**
         * Get all steps for a loadable
         * @param loadableId - The loadable instance ID
         * @returns Atom for all steps in order
         */
        steps: (loadableId: string) => stepsAtomFamily(loadableId),

        /**
         * Get results for a step across all active sessions
         * @param loadableId - The loadable instance ID
         * @param stepId - The step ID
         * @returns Atom for step results keyed by sessionId
         */
        resultsForStep: (loadableId: string, stepId: string) =>
            resultsForStepAtomFamily({loadableId, stepId}),

        /**
         * Get a single result for a step and session
         * @param loadableId - The loadable instance ID
         * @param stepId - The step ID
         * @param sessionId - The session ID
         * @returns Atom for the result
         */
        resultForStepSession: (loadableId: string, stepId: string, sessionId: string) =>
            resultAtomFamily({loadableId, stepId, sessionId}),

        /**
         * Check if a step is currently running (any session)
         * @param loadableId - The loadable instance ID
         * @param stepId - The step ID
         * @returns Atom that returns true if running
         */
        isStepRunning: (loadableId: string, stepId: string) =>
            isStepRunningAtomFamily({loadableId, stepId}),

        /**
         * Check if any execution is running for a loadable
         * @param loadableId - The loadable instance ID
         * @returns Atom that returns true if any execution is running
         */
        isAnyExecuting: (loadableId: string) => isAnyExecutingAtomFamily(loadableId),

        /**
         * Get execution progress for UI display
         * @param loadableId - The loadable instance ID
         * @returns Atom for progress info
         */
        progress: (loadableId: string) => executionProgressAtomFamily(loadableId),

        /**
         * Get complete execution state summary
         * @param loadableId - The loadable instance ID
         * @returns Atom for full state summary
         */
        stateSummary: (loadableId: string) => executionStateSummaryAtomFamily(loadableId),
    },

    /**
     * Actions for execution management
     */
    actions: {
        // ----------------------------------------------------------------
        // Context-aware actions (auto-inject loadableId from primary node)
        // ----------------------------------------------------------------

        /**
         * Run a step with automatic loadableId derivation
         *
         * This is the recommended action for most use cases. It automatically
         * derives the loadableId from the primary node.
         *
         * @example
         * const runStep = useSetAtom(executionController.actions.runStepWithContext)
         * await runStep({ stepId: "row-123", data: { prompt: "Hello" } })
         */
        runStepWithContext: runStepWithContextAtom,

        /**
         * Initialize sessions with automatic loadableId derivation
         *
         * @example
         * const initSessions = useSetAtom(executionController.actions.initSessionsWithContext)
         * initSessions({
         *     sessions: [
         *         { id: "sess:rev1", runnableId: "rev1", runnableType: "appRevision", mode: "completion" }
         *     ]
         * })
         */
        initSessionsWithContext: initSessionsWithContextAtom,

        /**
         * Cancel a step with automatic loadableId derivation
         */
        cancelStepWithContext: cancelStepWithContextAtom,

        /**
         * Reset execution with automatic loadableId derivation
         */
        resetWithContext: resetExecutionWithContextAtom,

        // ----------------------------------------------------------------
        // Parameterized actions (require explicit loadableId)
        // ----------------------------------------------------------------

        /**
         * Initialize execution sessions
         *
         * Replaces all existing sessions with the provided sessions.
         * Also sets all sessions as active by default.
         *
         * @example
         * const init = useSetAtom(executionController.actions.initSessions)
         * init({
         *     loadableId: "loadable-1",
         *     sessions: [
         *         { id: "sess:rev1", runnableId: "rev1", runnableType: "appRevision", mode: "completion" }
         *     ]
         * })
         */
        initSessions: initSessionsAtom,

        /**
         * Add a single session
         */
        addSession: addSessionAtom,

        /**
         * Remove a session and its results
         */
        removeSession: removeSessionAtom,

        /**
         * Set active sessions (for compare mode)
         */
        setActiveSessions: setActiveSessionsAtom,

        // ----------------------------------------------------------------
        // Step management actions (chat mode)
        // ----------------------------------------------------------------

        /**
         * Add a step (primarily for chat mode)
         */
        addStep: addStepAtom,

        /**
         * Update step input (for editing before execution)
         */
        updateStepInput: updateStepInputAtom,

        /**
         * Remove a step and its results
         */
        removeStep: removeStepAtom,

        // ----------------------------------------------------------------
        // Execution actions (parameterized)
        // ----------------------------------------------------------------

        /**
         * Run a step across sessions
         *
         * This is the main execution action that supports multi-session compare mode.
         * It executes the step for each active session (or specified sessions) in parallel.
         *
         * @example
         * const runStep = useSetAtom(executionController.actions.runStep)
         * await runStep({
         *     loadableId: "loadable-1",
         *     stepId: "row-123",
         *     data: { prompt: "Hello" }
         * })
         */
        runStep: runStepAtom,

        /**
         * Cancel a step for sessions
         */
        cancelStep: cancelStepAtom,

        /**
         * Reset execution state (clears all sessions, steps, and results)
         */
        reset: resetExecutionAtom,
    },
}

// ============================================================================
// TYPE EXPORTS (for consumers)
// ============================================================================

export type {
    ExecutionSession,
    ExecutionStep,
    RunResult,
    ExecutionMode,
    InitSessionsPayload,
    RunStepPayload,
    AddStepPayload,
    CancelStepPayload,
    RunStepWithContextPayload,
}
