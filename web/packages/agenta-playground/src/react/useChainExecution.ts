/**
 * useChainExecution Hook
 *
 * Thin React wrapper around executionController context-aware selectors and actions.
 * All business logic lives in the controller - this hook just provides React bindings.
 *
 * For most use cases, you can use the controller directly:
 *
 * ```typescript
 * import { executionController } from '@agenta/playground'
 * import { useAtomValue, useSetAtom } from 'jotai'
 *
 * // Read state
 * const sessions = useAtomValue(executionController.selectors.activeSessionsWithContext)
 * const isExecuting = useAtomValue(executionController.selectors.isAnyExecutingWithContext)
 *
 * // Execute
 * const runStep = useSetAtom(executionController.actions.runStepWithContext)
 * await runStep({ stepId: rowId, data })
 * ```
 *
 * This hook provides a convenience wrapper that bundles these together.
 *
 * @see executionController for the actual execution orchestration logic
 */

import {useAtomValue, useSetAtom} from "jotai"

import {executionController, type ExecutionSession, type RunStepWithContextPayload} from "../state"

// ============================================================================
// RETURN TYPE
// ============================================================================

export interface UseChainExecutionReturn {
    /**
     * Execute a step across active sessions
     *
     * @param payload - Step execution payload
     * @param payload.stepId - The step ID (rowId for completion mode)
     * @param payload.data - Input data for the step
     * @param payload.sessionIds - Optional specific sessions to run (defaults to all active)
     */
    runStep: (payload: RunStepWithContextPayload) => Promise<void>

    /** Active sessions */
    sessions: ExecutionSession[]

    /** Whether in compare mode (multiple sessions) */
    isCompareMode: boolean

    /** Whether any execution is currently running */
    isExecuting: boolean

    /** The derived loadable ID (from primary node) */
    loadableId: string
}

// ============================================================================
// HOOK IMPLEMENTATION
// ============================================================================

/**
 * Hook for managing chain execution in the playground
 *
 * This is a thin wrapper around executionController's context-aware API.
 * All execution orchestration logic is in the controller.
 *
 * @returns Functions to execute steps and access execution state
 *
 * @example
 * const { runStep, sessions, isCompareMode, isExecuting } = useChainExecution()
 *
 * // Run a step
 * await runStep({ stepId: 'row-123', data: { prompt: 'Hello' } })
 *
 * @example
 * // For more control, use the controller directly:
 * const loadableId = useAtomValue(executionController.selectors.derivedLoadableId)
 * const runStep = useSetAtom(executionController.actions.runStepWithContext)
 */
export function useChainExecution(): UseChainExecutionReturn {
    // ========================================================================
    // CONTEXT-AWARE SELECTORS (derived from primary node)
    // ========================================================================

    const loadableId = useAtomValue(executionController.selectors.derivedLoadableId)
    const sessions = useAtomValue(executionController.selectors.activeSessionsWithContext)
    const isCompareMode = useAtomValue(executionController.selectors.isCompareModeWithContext)
    const isExecuting = useAtomValue(executionController.selectors.isAnyExecutingWithContext)

    // ========================================================================
    // CONTEXT-AWARE ACTIONS
    // ========================================================================

    const runStep = useSetAtom(executionController.actions.runStepWithContext)

    // ========================================================================
    // RETURN VALUE
    // ========================================================================

    return {
        runStep,
        sessions,
        isCompareMode,
        isExecuting,
        loadableId,
    }
}
