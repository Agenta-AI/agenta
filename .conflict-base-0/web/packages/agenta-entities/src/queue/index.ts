/**
 * Queue Controller Module
 *
 * Unified controller that bridges SimpleQueue and EvaluationQueue
 * into a single API with probing + type hints.
 *
 * ## Quick Start
 *
 * ```typescript
 * import { queueController } from '@agenta/entities/queue'
 *
 * // Register type hint (optional, improves performance)
 * queueController.registerTypeHint(queueId, "simple")
 *
 * // Reactive selectors
 * const data = useAtomValue(queueController.selectors.data(queueId))
 * const status = useAtomValue(queueController.selectors.status(queueId))
 *
 * // Type-scoped selectors (no probing)
 * const simpleSelectors = queueController.selectors.forType("simple")
 * const simpleData = useAtomValue(simpleSelectors.data(queueId))
 *
 * // Imperative API
 * const data = queueController.get.data(queueId)
 * ```
 */

// ============================================================================
// CONTROLLER (Primary API)
// ============================================================================

export {
    queueController,
    type QueueController,
    // Type hint utilities (also available via queueController.*)
    registerQueueTypeHint,
    getQueueTypeHint,
    clearQueueTypeHint,
    clearAllQueueTypeHints,
} from "./controller"

// ============================================================================
// TYPES
// ============================================================================

export type {QueueType, QueueData, QueueQueryState} from "./types"
