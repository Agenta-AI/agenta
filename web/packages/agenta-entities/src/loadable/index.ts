/**
 * Loadable Module
 *
 * Data source management for entities that provide inputs to runnables.
 *
 * A loadable represents a data source (like a testset or trace) that provides
 * input rows for execution. Loadables can operate in local or connected mode.
 *
 * ## Controller API (Recommended)
 *
 * The loadableController provides a flat, entity-agnostic API that internally
 * dispatches to the appropriate entity implementation based on connectedSourceType.
 *
 * ```typescript
 * import { loadableController } from '@agenta/entities/loadable'
 *
 * // Selectors - flat API (entity-agnostic)
 * const rows = useAtomValue(loadableController.selectors.rows(loadableId))
 * const columns = useAtomValue(loadableController.selectors.columns(loadableId))
 * const isDirty = useAtomValue(loadableController.selectors.isDirty(loadableId))
 *
 * // Actions - flat API (entity-agnostic)
 * const addRow = useSetAtom(loadableController.actions.addRow)
 * addRow(loadableId, { input: 'test' })
 *
 * // Connect to a testset (sets connectedSourceType: 'testcase')
 * const connect = useSetAtom(loadableController.actions.connectToSource)
 * connect(loadableId, revisionId, 'MyTestset v1', testcases)
 * ```
 *
 * ## Bridge API (Simplified Access)
 *
 * For simpler use cases, the loadableBridge provides direct atom access:
 *
 * ```typescript
 * import { loadableBridge } from '@agenta/entities/loadable'
 *
 * const rows = useAtomValue(loadableBridge.rows(loadableId))
 * const addRow = useSetAtom(loadableBridge.actions.addRow)
 * ```
 *
 * ## Entity-Specific Access (Advanced)
 *
 * For entity-specific features not in the unified API:
 *
 * ```typescript
 * // Access entity implementation directly
 * const newColumnKeys = useAtomValue(
 *   loadableController.entities.testset.selectors.newColumnKeys(id)
 * )
 * ```
 */

// ============================================================================
// TYPES (from types.ts and shared)
// ============================================================================

export type {
    // Loadable-specific types
    LoadableMode,
    LoadableSourceType,
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
// BRIDGE (Recommended for UI)
// ============================================================================

export {loadableBridge} from "./bridge"

// Re-export the factory for custom configurations
export {createLoadableBridge} from "../shared"

// ============================================================================
// CONTROLLER (Full Feature Access)
// ============================================================================

export {
    loadableController,
    testsetLoadable,
    derivedColumnChangesAtomFamily,
    // Single source of truth for trace-derived data (paths + metrics)
    traceDataSummaryAtomFamily,
    type TraceDataSummary,
    type TraceMetrics,
} from "./controller"

// ============================================================================
// STORE ATOMS (advanced usage)
// ============================================================================
export {
    loadableStateAtomFamily,
    loadableColumnsAtomFamily,
    loadableModeAtomFamily,
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
