/**
 * @agenta/entities - Entity State Management Package
 *
 * This package provides entity state management for the Agenta web application.
 *
 * ## Quick Start
 *
 * ```typescript
 * import { testcase, runnable, loadable } from '@agenta/entities'
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
 * @deprecated Use `workflow` instead. Evaluators are workflows with `flags.is_evaluator === true`.
 */
export {workflowMolecule as evaluator} from "./workflow"

/**
 * Trace span entity controller.
 * Manages trace span state with attribute editing.
 */
export {traceSpanMolecule as traceSpan} from "./trace"

/**
 * Environment entity controller.
 * Manages environment state with deployment and guard operations.
 *
 * Uses the new git-based SimpleEnvironment API (PR #3627).
 *
 * @example
 * ```typescript
 * const data = useAtomValue(environment.data(envId))
 * const envBySlug = environment.get.bySlug('production')
 * ```
 */
export {environmentMolecule as environment} from "./environment"

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

// ============================================================================
// TYPES (PascalCase - no conflict with controllers)
// ============================================================================

// Entity data types
export type {Testcase} from "./testcase"
export type {Revision, Testset} from "./testset"
export type {
    Workflow as Evaluator,
    WorkflowData as EvaluatorData,
    WorkflowFlags as EvaluatorFlags,
} from "./workflow"
export type {TraceSpan} from "./trace"
export type {Environment, EnvironmentRevision, EnvironmentRevisionData} from "./environment"

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
export {evaluatorSelectionConfig, type EvaluatorSelectionConfig} from "./workflow"

// ============================================================================
// QUEUE ENTITIES & CONTROLLER
// ============================================================================

/**
 * SimpleQueue entity controller.
 * Manages simple annotation queues (traces/testcases) via `/preview/simple/queues/`.
 */
export {simpleQueueMolecule as simpleQueue} from "./simpleQueue"

/**
 * EvaluationQueue entity controller.
 * Manages evaluation run queues via `/evaluations/queues/`.
 */
export {evaluationQueueMolecule as evaluationQueue} from "./evaluationQueue"

/**
 * Queue controller — unified API that bridges SimpleQueue and EvaluationQueue.
 * Uses probing + type hints for multi-type dispatch.
 *
 * @example
 * ```typescript
 * const data = useAtomValue(queue.selectors.data(queueId))
 * const status = useAtomValue(queue.selectors.status(queueId))
 * queue.registerTypeHint(queueId, "simple")
 * ```
 */
export {queueController as queue} from "./queue"

// Queue types
export type {SimpleQueue} from "./simpleQueue"
export type {EvaluationQueue} from "./evaluationQueue"
export type {QueueType, QueueData, QueueQueryState} from "./queue"

// ============================================================================
// EVALUATION RUN ENTITY
// ============================================================================

/**
 * EvaluationRun entity controller.
 * Read-only access to evaluation run data with automatic batch fetching.
 * Queues reference runs via `run_id` — use this entity to access evaluator configuration.
 *
 * @example
 * ```typescript
 * const data = useAtomValue(evaluationRun.selectors.data(runId))
 * const evaluatorIds = useAtomValue(evaluationRun.selectors.evaluatorIds(runId))
 * ```
 */
export {evaluationRunMolecule as evaluationRun} from "./evaluationRun"

// EvaluationRun types
export type {EvaluationRun, EvaluationRunDataStep} from "./evaluationRun"

// ============================================================================
// ANNOTATION ENTITY
// ============================================================================

/**
 * Annotation entity controller.
 * Manages annotation entities keyed by composite `traceId:spanId`.
 * Returns `Annotation[]` per key (multiple annotations per trace/span pair).
 *
 * @example
 * ```typescript
 * const compositeId = encodeAnnotationId(traceId, spanId)
 * const annotations = useAtomValue(annotation.selectors.data(compositeId))
 * annotation.cache.invalidateByLink(traceId, spanId)
 * ```
 */
export {annotationMolecule as annotation} from "./annotation"

// Annotation types
export type {Annotation, AnnotationDraft} from "./annotation"

// ============================================================================
// SUBPATH IMPORTS (Advanced Usage)
// ============================================================================
// For specialized utilities not available through the main export,
// use subpath imports:
//
//   import { testcasePaginatedStore } from '@agenta/entities/testcase'
//   import { extractTemplateVariables } from '@agenta/entities/runnable'
//   import { traceSpanMolecule } from '@agenta/entities/trace'
//   import { queueController } from '@agenta/entities/queue'
//   import { simpleQueueMolecule } from '@agenta/entities/simpleQueue'
//   import { evaluationQueueMolecule } from '@agenta/entities/evaluationQueue'
//   import { annotationMolecule, encodeAnnotationId } from '@agenta/entities/annotation'
//   import { evaluationRunMolecule } from '@agenta/entities/evaluationRun'
