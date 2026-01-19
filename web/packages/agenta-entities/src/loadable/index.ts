/**
 * Loadable Module
 *
 * Data source management for entities that provide inputs to runnables.
 *
 * A loadable represents a data source (like a testset or trace) that provides
 * input rows for execution. Loadables can operate in local or connected mode.
 *
 * ## New API (Recommended)
 *
 * ```typescript
 * import { loadableBridge } from '@agenta/entities/loadable'
 *
 * // Unified API works with any source type
 * const rows = useAtomValue(loadableBridge.selectors.rows(loadableId))
 * const addRow = useSetAtom(loadableBridge.actions.addRow)
 *
 * // Connect to a testset
 * const connect = useSetAtom(loadableBridge.actions.connectToSource)
 * connect(loadableId, revisionId, 'MyTestset v1', 'testcase')
 * ```
 *
 * ## Legacy API (Backwards Compatible)
 *
 * ```typescript
 * import { loadableController, useLoadable } from '@agenta/entities/loadable'
 *
 * // Hook usage
 * const loadable = useLoadable(loadableId)
 * loadable.rows
 * loadable.addRow({ input: "test" })
 *
 * // Direct atom access
 * const rows = useAtomValue(loadableController.testset.selectors.rows(id))
 * ```
 */

// ============================================================================
// TYPES (from types.ts and shared)
// ============================================================================

export type {
    // Loadable-specific types
    LoadableMode,
    ConnectedSource,
    LinkedRunnable,
    LoadableState,
    // Re-exported shared types (from runnable/types)
    TestsetRow,
    TestsetColumn,
    ExecutionStatus,
    ExecutionMetrics,
    RowExecutionResult,
    ChainProgress,
    StageExecutionResult,
    RunnableType,
} from "./types"

// Re-export bridge types
export type {
    LoadableRow,
    LoadableColumn,
    LoadableBridge,
    LoadableBridgeSelectors,
    LoadableBridgeActions,
    LoadableSourceConfig,
    CreateLoadableBridgeConfig,
} from "../shared"

// ============================================================================
// NEW API: LOADABLE BRIDGE (Recommended)
// ============================================================================

export {loadableBridge} from "./bridge"

// Re-export the factory for custom configurations
export {createLoadableBridge} from "../shared"

// ============================================================================
// LEGACY API: CONTROLLER & HOOK (Backwards Compatible)
// ============================================================================

// Legacy controller exports (deprecated, use loadableBridge)
export {loadableController, testsetLoadable} from "./bridge"

// Hook (works with both old and new API)
export {useLoadable} from "./useLoadable"
export type {UseLoadableReturn} from "./useLoadable"

// ============================================================================
// STORE ATOMS (pure state - advanced usage)
// ============================================================================

// Legacy atoms (still useful for direct access)
export {
    loadableStateAtomFamily,
    loadableRowsAtomFamily,
    loadableColumnsAtomFamily,
    loadableAllColumnsAtomFamily,
    loadableActiveRowAtomFamily,
    loadableRowCountAtomFamily,
    loadableModeAtomFamily,
    loadableIsDirtyAtomFamily,
    loadableHasLocalChangesAtomFamily,
    loadableExecutionResultsAtomFamily,
    loadableDataAtomFamily,
    loadableConnectedSourceAtomFamily,
    loadableLinkedRunnableAtomFamily,
} from "./store"

// New shared state family (from bridge factory)
export {loadableStateFamily} from "../shared"
