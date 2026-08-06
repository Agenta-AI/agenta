/**
 * SimpleQueue Entity Module
 *
 * Provides molecules and utilities for managing SimpleQueue entities.
 *
 * ## Quick Start
 *
 * ```typescript
 * import { simpleQueueMolecule } from '@agenta/entities/simpleQueue'
 *
 * // Reactive atoms (for useAtomValue)
 * const data = useAtomValue(simpleQueueMolecule.selectors.data(queueId))
 * const kind = useAtomValue(simpleQueueMolecule.selectors.kind(queueId))
 *
 * // Write atoms (for useSetAtom)
 * set(simpleQueueMolecule.actions.update, queueId, { name: 'New name' })
 *
 * // Imperative API
 * const data = simpleQueueMolecule.get.data(queueId)
 * ```
 */

// ============================================================================
// MOLECULE (Primary API)
// ============================================================================

export {
    simpleQueueMolecule,
    type SimpleQueueMolecule,
    type QueueScenarioProgress,
} from "./state/molecule"

// ============================================================================
// SCHEMAS & TYPES
// ============================================================================

export {
    // Enums
    simpleQueueKindSchema,
    type SimpleQueueKind,
    evaluationStatusSchema,
    type EvaluationStatus,
    // Sub-schemas
    simpleQueueSettingsSchema,
    type SimpleQueueSettings,
    simpleQueueDataSchema,
    type SimpleQueueData,
    // Entity
    simpleQueueSchema,
    type SimpleQueue,
    // Evaluation scenario
    evaluationScenarioSchema,
    type EvaluationScenario,
    // Response schemas
    simpleQueueResponseSchema,
    type SimpleQueueResponse,
    simpleQueuesResponseSchema,
    type SimpleQueuesResponse,
    simpleQueueIdResponseSchema,
    type SimpleQueueIdResponse,
    simpleQueueIdsResponseSchema,
    type SimpleQueueIdsResponse,
    simpleQueueScenariosResponseSchema,
    type SimpleQueueScenariosResponse,
} from "./core"

export type {
    SimpleQueueListParams,
    SimpleQueueDetailParams,
    SimpleQueueScenariosParams,
} from "./core"

// ============================================================================
// API FUNCTIONS
// ============================================================================

export {
    createSimpleQueue,
    type CreateSimpleQueuePayload,
    querySimpleQueues,
    fetchSimpleQueue,
    deleteSimpleQueue,
    deleteSimpleQueues,
    querySimpleQueueScenarios,
    addSimpleQueueTraces,
    addSimpleQueueTestcases,
} from "./api"

// ============================================================================
// STATE ATOMS
// ============================================================================

export {
    // List query
    simpleQueuesListQueryAtom,
    simpleQueuesListDataAtom,
    // Single entity
    simpleQueueQueryAtomFamily,
    simpleQueueDraftAtomFamily,
    simpleQueueEntityAtomFamily,
    simpleQueueIsDirtyAtomFamily,
    // Draft mutations
    updateSimpleQueueDraftAtom,
    discardSimpleQueueDraftAtom,
    // Server mutations
    createSimpleQueueAtom,
    deleteSimpleQueueAtom,
    deleteSimpleQueuesAtom,
    addTracesToQueueAtom,
    addTestcasesToQueueAtom,
    // Cache invalidation
    invalidateSimpleQueuesListCache,
    invalidateSimpleQueueCache,
    invalidateScenarioProgressCache,
    // Paginated store (queues)
    simpleQueuePaginatedStore,
    simpleQueueKindFilterAtom,
    simpleQueueSearchTermAtom,
    type SimpleQueueTableRow,
} from "./state"
