/**
 * @agenta/entities - Entity State Management Package
 *
 * This package provides entity state management for the Agenta web application.
 *
 * ## Quick Start
 *
 * ```typescript
 * import { testcase, appRevision, runnable, loadable } from '@agenta/entities'
 *
 * // === BASE API (same for all entities) ===
 *
 * // Reactive (for useAtomValue, atom compositions)
 * const data = useAtomValue(testcase.atoms.data(id))
 *
 * // In atom compositions - use actions with set()
 * set(testcase.actions.update, id, changes)
 *
 * // Imperative (for callbacks)
 * const data = testcase.get.data(id)
 * testcase.set.update(id, changes)
 *
 * // === CAPABILITY APIs ===
 *
 * // Runnable API (appRevision, evaluator)
 * appRevision.runnable.inputPorts(id)
 * appRevision.runnable.config(id)
 *
 * // Loadable API (testcase)
 * testcase.loadable.rows(revisionId)
 *
 * // === BRIDGES (unified cross-entity access) ===
 * runnable.inputPorts(runnableId)   // works for any runnable entity
 * loadable.rows(loadableId)         // works for any loadable entity
 * ```
 *
 * ## Entity Controllers
 *
 * All entities implement a uniform base interface:
 * - **atoms**: Reactive subscriptions (for useAtomValue, atom compositions)
 * - **actions**: Write atoms (for use in other atoms with set())
 * - **get**: Imperative reads (for callbacks)
 * - **set**: Imperative writes (for callbacks)
 *
 * ## Subpath Imports
 *
 * For specialized utilities, use subpath imports:
 * ```typescript
 * import { testcasePaginatedStore } from '@agenta/entities/testcase'
 * import { extractTemplateVariables } from '@agenta/entities/runnable'
 * ```
 *
 * @module @agenta/entities
 */

// ============================================================================
// SHARED UTILITIES
// ============================================================================

export {
    createEntityDraftState,
    normalizeValueForComparison,
    createEntityController,
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
    type EntitySchemaSelectors,
    type PathItem,
    type SchemaProperty,
    type UseEntityControllerResult,
    // Schema utilities
    type EntitySchema,
    type EntitySchemaProperty,
    type EvaluatorField,
    getSchemaAtPath,
    getSchemaKeys,
    isArrayPath,
    getDefaultValue,
    createDefaultArrayItem,
    evaluatorFieldToSchema,
    evaluatorFieldsToSchema,
    extractPromptSchema,
    extractCustomPropertiesSchema,
    messageSchema,
    messagesSchema,
} from "./shared"

// ============================================================================
// ENTITY CONTROLLERS (Clean Named Exports)
// ============================================================================
// Entity controllers provide a uniform API for state management.
// "molecule" is an implementation detail - use these clean names externally.

/**
 * Testcase entity controller.
 * Implements LoadableCapability for row/column access.
 *
 * @example
 * ```typescript
 * const data = useAtomValue(testcase.atoms.data(id))
 * testcase.set.update(id, changes)
 * ```
 */
export {testcaseMolecule as testcase} from "./testcase"

/**
 * Revision entity controller.
 * Manages testset revision state.
 */
export {revisionMolecule as revision} from "./testset"

/**
 * Testset entity controller.
 * Manages testset metadata and revision lists.
 */
export {testsetMolecule as testset} from "./testset"

/**
 * App revision entity controller.
 * Implements RunnableCapability for input/output ports.
 *
 * @example
 * ```typescript
 * const ports = useAtomValue(appRevision.runnable.inputPorts(id))
 * ```
 */
export {appRevisionMolecule as appRevision} from "./appRevision"

/**
 * Trace span entity controller.
 * Manages trace span state with attribute editing.
 */
export {traceSpanMolecule as traceSpan} from "./trace"

// ============================================================================
// BRIDGES (Unified Cross-Entity Access)
// ============================================================================
// Bridges provide unified access when you don't care about entity type.
// Use these in playground and other multi-entity contexts.

/**
 * Loadable bridge - unified access to data sources.
 * Works with any entity that provides rows/columns (testcase, trace, etc.)
 *
 * @example
 * ```typescript
 * const rows = useAtomValue(loadable.rows(loadableId))
 * const columns = useAtomValue(loadable.columns(loadableId))
 * ```
 */
export {loadableBridge as loadable} from "./loadable"

/**
 * Runnable bridge - unified access to executables.
 * Works with any runnable entity (appRevision, evaluator, etc.)
 *
 * @example
 * ```typescript
 * const ports = useAtomValue(runnable.inputPorts(runnableId))
 * const config = useAtomValue(runnable.config(runnableId))
 * ```
 */
export {runnableBridge as runnable} from "./runnable"

// ============================================================================
// TYPES (PascalCase - no conflict with controllers)
// ============================================================================

// Entity data types
export type {Testcase} from "./testcase"
export type {Revision, Testset} from "./testset"
export type {AppRevisionData} from "./appRevision"
export type {TraceSpan} from "./trace"

// Public API interfaces
export type {
    EntityController,
    RunnableCapability,
    LoadableCapability,
    RunnableEntity,
    LoadableEntity,
    RunnablePort,
    LoadableRow,
    LoadableColumn,
} from "./shared"

// ============================================================================
// SELECTION CONFIGS (For Entity Selection UI)
// ============================================================================
// Pre-built configs for initializing the entity selection system.
// Use these with initializeSelectionSystem() from @agenta/entity-ui.

export {testsetSelectionConfig, type TestsetSelectionConfig} from "./testset"
export {appRevisionSelectionConfig, type AppRevisionSelectionConfig} from "./appRevision"

// ============================================================================
// SUBPATH IMPORTS (Advanced Usage)
// ============================================================================
// For specialized utilities not available through the main export,
// use subpath imports:
//
//   import { testcasePaginatedStore } from '@agenta/entities/testcase'
//   import { extractTemplateVariables } from '@agenta/entities/runnable'
//   import { traceSpanMolecule } from '@agenta/entities/trace'
