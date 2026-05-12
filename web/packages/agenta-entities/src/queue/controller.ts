/**
 * Queue Controller
 *
 * Unified controller that bridges SimpleQueue and EvaluationQueue molecules
 * into a single API. Uses a probing + type-hint pattern for multi-type dispatch.
 *
 * ## How It Works
 *
 * When accessing a queue by ID, the controller:
 * 1. Checks for a registered type hint (fast path — skips probing)
 * 2. If no hint, probes both molecule types (SimpleQueue first, then EvaluationQueue)
 * 3. Returns unified `QueueData` regardless of the underlying type
 *
 * ## Type Hints
 *
 * Register hints when you know the queue type upfront (e.g., from a list response
 * or URL parameter) to avoid unnecessary API calls:
 *
 * ```typescript
 * queueController.registerTypeHint(queueId, "simple")
 * ```
 *
 * @example
 * ```typescript
 * import { queueController } from '@agenta/entities/queue'
 *
 * // Reactive selectors
 * const data = useAtomValue(queueController.selectors.data(queueId))
 * const status = useAtomValue(queueController.selectors.status(queueId))
 *
 * // Imperative API
 * const data = queueController.get.data(queueId)
 * const type = queueController.get.type(queueId)
 * ```
 *
 * @packageDocumentation
 */

import {atom, type Atom} from "jotai"
import {getDefaultStore} from "jotai/vanilla"
import {atomFamily} from "jotai-family"

import type {EvaluationQueue} from "../evaluationQueue/core"
import {evaluationQueueMolecule} from "../evaluationQueue/state/molecule"
import type {StoreOptions} from "../shared"
import type {SimpleQueue, SimpleQueueKind} from "../simpleQueue/core"
import {simpleQueueMolecule} from "../simpleQueue/state/molecule"

import type {QueueType, QueueData, QueueQueryState} from "./types"

// ============================================================================
// HELPERS
// ============================================================================

function getStore(options?: StoreOptions) {
    return options?.store ?? getDefaultStore()
}

// ============================================================================
// TYPE HINT REGISTRY
// ============================================================================

/**
 * Type hint registry for queue IDs.
 *
 * When a queue ID has a registered type hint, controller selectors skip probing
 * the other molecule type and go directly to the hinted type's molecule.
 */
const _queueTypeHints = new Map<string, QueueType>()

/** Register a type hint for a queue ID */
export function registerQueueTypeHint(id: string, type: QueueType): void {
    _queueTypeHints.set(id, type)
}

/** Get the type hint for a queue ID (if registered) */
export function getQueueTypeHint(id: string): QueueType | undefined {
    return _queueTypeHints.get(id)
}

/** Clear a type hint for a queue ID */
export function clearQueueTypeHint(id: string): void {
    _queueTypeHints.delete(id)
}

/** Clear all type hints (for cleanup) */
export function clearAllQueueTypeHints(): void {
    _queueTypeHints.clear()
}

// ============================================================================
// QUEUE TYPE CONFIGS
// ============================================================================

/**
 * Type-erased config used internally for probing across queue types.
 * Each config is created via `createQueueConfig` which preserves type safety
 * at the boundary, then erases the entity type for uniform storage.
 */
interface ErasedQueueConfig {
    molecule: {
        selectors: {
            data: (id: string) => Atom<unknown>
            query: (
                id: string,
            ) => Atom<{data: unknown; isPending: boolean; isError: boolean; error?: Error | null}>
            isDirty: (id: string) => Atom<boolean>
            status: (id: string) => Atom<string | null>
        }
    }
    toQueueData: (entity: unknown) => QueueData
}

/**
 * Create a type-safe queue config that erases the entity type for uniform storage.
 */
function createQueueConfig<TEntity>(config: {
    molecule: {
        selectors: {
            data: (id: string) => Atom<TEntity | null>
            query: (id: string) => Atom<{
                data: TEntity | null
                isPending: boolean
                isError: boolean
                error?: Error | null
            }>
            isDirty: (id: string) => Atom<boolean>
            status: (id: string) => Atom<string | null>
        }
    }
    toQueueData: (entity: TEntity) => QueueData
}): ErasedQueueConfig {
    return config as unknown as ErasedQueueConfig
}

/**
 * Map a SimpleQueue entity to the unified QueueData shape.
 */
function simpleQueueToQueueData(entity: SimpleQueue): QueueData {
    return {
        id: entity.id,
        type: "simple",
        name: entity.name ?? null,
        description: entity.description ?? null,
        status: entity.status ?? null,
        runId: entity.run_id,
        kind: (entity.data?.kind as SimpleQueueKind) ?? null,
        createdAt: entity.created_at ?? null,
        createdById: entity.created_by_id ?? null,
    }
}

/**
 * Map an EvaluationQueue entity to the unified QueueData shape.
 */
function evaluationQueueToQueueData(entity: EvaluationQueue): QueueData {
    return {
        id: entity.id,
        type: "evaluation",
        name: entity.name ?? null,
        description: entity.description ?? null,
        status: entity.status ?? null,
        runId: entity.run_id,
        kind: null, // EvaluationQueue doesn't have a kind
        createdAt: entity.created_at ?? null,
        createdById: entity.created_by_id ?? null,
    }
}

/**
 * Registry of queue type configurations.
 */
const queueConfigs: Record<QueueType, ErasedQueueConfig> = {
    simple: createQueueConfig<SimpleQueue>({
        molecule: simpleQueueMolecule,
        toQueueData: simpleQueueToQueueData,
    }),
    evaluation: createQueueConfig<EvaluationQueue>({
        molecule: evaluationQueueMolecule,
        toQueueData: evaluationQueueToQueueData,
    }),
}

// ============================================================================
// PROBING HELPERS
// ============================================================================

/**
 * Get the hinted config for a queue ID, if a type hint is registered.
 */
function getHintedConfig(queueId: string) {
    const hintedType = _queueTypeHints.get(queueId)
    if (hintedType && queueConfigs[hintedType]) {
        return {type: hintedType, config: queueConfigs[hintedType]}
    }
    return null
}

// ============================================================================
// UNIFIED SELECTOR ATOM FAMILIES
// ============================================================================

/**
 * Unified data selector — probes both molecule types, returns QueueData.
 */
const dataFamily = atomFamily((queueId: string) =>
    atom<QueueData | null>((get) => {
        const hinted = getHintedConfig(queueId)
        if (hinted) {
            const entity = get(hinted.config.molecule.selectors.data(queueId))
            if (!entity) return null
            return hinted.config.toQueueData(entity)
        }
        // Probe: try simple first, then evaluation
        for (const [_type, config] of Object.entries(queueConfigs)) {
            const entity = get(config.molecule.selectors.data(queueId))
            if (entity) {
                return config.toQueueData(entity)
            }
        }
        return null
    }),
)

/**
 * Unified query state selector — probes both molecule types.
 */
const queryFamily = atomFamily((queueId: string) =>
    atom<QueueQueryState>((get) => {
        const hinted = getHintedConfig(queueId)
        if (hinted) {
            const query = get(hinted.config.molecule.selectors.query(queueId))
            const entity = query.data
            return {
                data: entity ? hinted.config.toQueueData(entity) : null,
                isPending: query.isPending,
                isError: query.isError,
                error: query.error ?? null,
            }
        }
        for (const [_type, config] of Object.entries(queueConfigs)) {
            const query = get(config.molecule.selectors.query(queueId))
            if (query.data || query.isPending || query.isError) {
                const entity = query.data
                return {
                    data: entity ? config.toQueueData(entity) : null,
                    isPending: query.isPending,
                    isError: query.isError,
                    error: query.error ?? null,
                }
            }
        }
        return {data: null, isPending: false, isError: false, error: null}
    }),
)

/**
 * Unified isDirty selector.
 */
const isDirtyFamily = atomFamily((queueId: string) =>
    atom<boolean>((get) => {
        const hinted = getHintedConfig(queueId)
        if (hinted) {
            return get(hinted.config.molecule.selectors.isDirty(queueId))
        }
        for (const [_type, config] of Object.entries(queueConfigs)) {
            const isDirty = get(config.molecule.selectors.isDirty(queueId))
            if (isDirty) return true
        }
        return false
    }),
)

/**
 * Unified status selector.
 */
const statusFamily = atomFamily((queueId: string) =>
    atom<string | null>((get) => {
        const hinted = getHintedConfig(queueId)
        if (hinted) {
            return get(hinted.config.molecule.selectors.status(queueId))
        }
        for (const [_type, config] of Object.entries(queueConfigs)) {
            const query = get(config.molecule.selectors.query(queueId))
            if (query.data || query.isPending || query.isError) {
                return get(config.molecule.selectors.status(queueId))
            }
        }
        return null
    }),
)

/**
 * Unified name selector.
 */
const nameFamily = atomFamily((queueId: string) =>
    atom<string | null>((get) => {
        const data = get(dataFamily(queueId))
        return data?.name ?? null
    }),
)

/**
 * Unified kind selector (simple queues only).
 */
const kindFamily = atomFamily((queueId: string) =>
    atom<SimpleQueueKind | null>((get) => {
        const data = get(dataFamily(queueId))
        return data?.kind ?? null
    }),
)

/**
 * Unified runId selector.
 */
const runIdFamily = atomFamily((queueId: string) =>
    atom<string | null>((get) => {
        const data = get(dataFamily(queueId))
        return data?.runId ?? null
    }),
)

/**
 * Queue type selector — returns the resolved type for a queue ID.
 */
const typeFamily = atomFamily((queueId: string) =>
    atom<QueueType | null>((get) => {
        const data = get(dataFamily(queueId))
        return data?.type ?? null
    }),
)

// ============================================================================
// TYPE-SCOPED SELECTORS
// ============================================================================

/**
 * Create type-scoped selectors for a specific queue type.
 * No probing — goes directly to the specified molecule.
 */
function createTypeScopedSelectors(type: QueueType) {
    const config = queueConfigs[type]
    return {
        data: (id: string) => config.molecule.selectors.data(id),
        query: (id: string) => config.molecule.selectors.query(id),
        isDirty: (id: string) => config.molecule.selectors.isDirty(id),
    }
}

// ============================================================================
// QUEUE CONTROLLER
// ============================================================================

/**
 * Queue controller — unified API for all queue types.
 *
 * Bridges SimpleQueue and EvaluationQueue molecules into a single interface.
 */
export const queueController = {
    // ========================================================================
    // SELECTORS (reactive atoms)
    // ========================================================================
    selectors: {
        /** Unified queue data (probes both types) */
        data: (queueId: string) => dataFamily(queueId),
        /** Unified query state */
        query: (queueId: string) => queryFamily(queueId),
        /** Is dirty (has local edits) */
        isDirty: (queueId: string) => isDirtyFamily(queueId),
        /** Queue status */
        status: (queueId: string) => statusFamily(queueId),
        /** Queue name */
        name: (queueId: string) => nameFamily(queueId),
        /** Queue kind (simple only) */
        kind: (queueId: string) => kindFamily(queueId),
        /** Parent run ID */
        runId: (queueId: string) => runIdFamily(queueId),
        /** Resolved queue type */
        type: (queueId: string) => typeFamily(queueId),

        /**
         * Type-specific selectors (no probing).
         * Use when you know the queue type upfront.
         */
        forType: createTypeScopedSelectors,
    },

    // ========================================================================
    // GET (imperative read API)
    // ========================================================================
    get: {
        data: (queueId: string, options?: StoreOptions) =>
            getStore(options).get(dataFamily(queueId)),
        query: (queueId: string, options?: StoreOptions) =>
            getStore(options).get(queryFamily(queueId)),
        isDirty: (queueId: string, options?: StoreOptions) =>
            getStore(options).get(isDirtyFamily(queueId)),
        status: (queueId: string, options?: StoreOptions) =>
            getStore(options).get(statusFamily(queueId)),
        name: (queueId: string, options?: StoreOptions) =>
            getStore(options).get(nameFamily(queueId)),
        kind: (queueId: string, options?: StoreOptions) =>
            getStore(options).get(kindFamily(queueId)),
        type: (queueId: string, options?: StoreOptions) =>
            getStore(options).get(typeFamily(queueId)),
        /** Get the type hint for a queue (without resolving via data) */
        typeHint: (queueId: string) => _queueTypeHints.get(queueId) ?? null,
    },

    // ========================================================================
    // CACHE (invalidation utilities)
    // ========================================================================
    cache: {
        /** Invalidate all queue list caches (both types) */
        invalidateAll: (options?: StoreOptions) => {
            simpleQueueMolecule.cache.invalidateList(options)
            evaluationQueueMolecule.cache.invalidateList(options)
        },
        /** Invalidate a specific queue's cache (routes to correct molecule) */
        invalidateQueue: (queueId: string, options?: StoreOptions) => {
            const hint = _queueTypeHints.get(queueId)
            if (hint === "simple") {
                simpleQueueMolecule.cache.invalidateDetail(queueId, options)
            } else if (hint === "evaluation") {
                evaluationQueueMolecule.cache.invalidateDetail(queueId, options)
            } else {
                // No hint — invalidate both
                simpleQueueMolecule.cache.invalidateDetail(queueId, options)
                evaluationQueueMolecule.cache.invalidateDetail(queueId, options)
            }
        },
    },

    // ========================================================================
    // TYPE HINT MANAGEMENT
    // ========================================================================
    registerTypeHint: registerQueueTypeHint,
    getTypeHint: getQueueTypeHint,
    clearTypeHint: clearQueueTypeHint,
    clearAllTypeHints: clearAllQueueTypeHints,

    // ========================================================================
    // MOLECULE ACCESS (for advanced composition)
    // ========================================================================
    molecules: {
        simple: simpleQueueMolecule,
        evaluation: evaluationQueueMolecule,
    },
}

export type QueueController = typeof queueController
