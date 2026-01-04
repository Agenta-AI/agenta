/**
 * Entity Management System
 *
 * Re-exports from entity modules. For most use cases, import directly
 * from the specific entity module:
 *
 * - testcase: @/oss/state/entities/testcase
 * - testset: @/oss/state/entities/testset
 * - trace: @/oss/state/entities/trace
 *
 * Shared utilities can be imported from:
 * - @/oss/state/entities/shared
 */

// Shared utilities
export {
    createEntityDraftState,
    createEntityController,
    type QueryResult,
    type QueryState,
    type DrillInConfig,
    type DrillInValueMode,
    type EntityAction,
    type EntityAPI,
    type EntityActions,
    type EntityControllerAtomFamily,
    type EntityControllerConfig,
    type EntityControllerState,
    type EntityDrillIn,
    type EntitySelectors,
    type PathItem,
    type UseEntityControllerResult,
} from "./shared"
