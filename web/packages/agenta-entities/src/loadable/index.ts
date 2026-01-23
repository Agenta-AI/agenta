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
    OutputMapping,
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

// Controller exports (full API with all selectors including derivedColumnChanges)
export {
    loadableController,
    testsetLoadable,
    derivedColumnChangesAtomFamily,
    // Single source of truth for trace-derived data (paths + metrics)
    traceDataSummaryAtomFamily,
    type TraceDataSummary,
    type TraceMetrics,
} from "./controller"

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
    loadableOutputMappingsAtomFamily,
} from "./store"

// ============================================================================
// UTILS
// ============================================================================

export {extractPaths, getValueAtPath, createOutputMappingId} from "./utils"

// New shared state family (from bridge factory)
export {loadableStateFamily} from "../shared"

// ============================================================================
// PAGINATED STORE (for InfiniteVirtualTable integration)
// ============================================================================

export {
    loadablePaginatedStore,
    loadablePaginatedMetaAtom,
    loadableIdAtom,
    loadableFilters,
    type LoadableTableRow,
    type LoadablePaginatedMeta,
} from "./state"
