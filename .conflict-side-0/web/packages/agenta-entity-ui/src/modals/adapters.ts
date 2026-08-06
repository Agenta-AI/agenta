/**
 * Entity Modal Adapters
 *
 * Registry for entity-specific modal behaviors.
 * Each entity type registers an adapter that defines how it should
 * be displayed and operated on in modals.
 */

import {getEntityTypeLabel, type EntityType, type EntityModalAdapter} from "./types"

// ============================================================================
// ADAPTER REGISTRY
// ============================================================================

/**
 * Registry of entity adapters
 */
const adapterRegistry = new Map<EntityType, EntityModalAdapter>()

/**
 * Register an entity adapter
 *
 * @param adapter The adapter to register
 * @throws Error if an adapter for this type is already registered
 *
 * @example
 * ```typescript
 * registerEntityAdapter(testsetAdapter)
 * ```
 */
export function registerEntityAdapter<TEntity>(adapter: EntityModalAdapter<TEntity>): void {
    if (adapterRegistry.has(adapter.type)) {
        console.warn(`[EntityModals] Overwriting existing adapter for type: ${adapter.type}`)
    }
    adapterRegistry.set(adapter.type, adapter as EntityModalAdapter)
}

/**
 * Get an entity adapter by type
 *
 * @param type The entity type
 * @returns The adapter if registered, undefined otherwise
 */
export function getEntityAdapter<TEntity = unknown>(
    type: EntityType,
): EntityModalAdapter<TEntity> | undefined {
    return adapterRegistry.get(type) as EntityModalAdapter<TEntity> | undefined
}

/**
 * Check if an adapter is registered for a type
 *
 * @param type The entity type
 * @returns Whether an adapter is registered
 */
export function hasEntityAdapter(type: EntityType): boolean {
    return adapterRegistry.has(type)
}

/**
 * Get all registered entity types
 *
 * @returns Array of registered entity types
 */
export function getRegisteredEntityTypes(): EntityType[] {
    return Array.from(adapterRegistry.keys())
}

/**
 * Clear all registered adapters (for testing)
 */
export function clearAdapterRegistry(): void {
    adapterRegistry.clear()
}

// ============================================================================
// ADAPTER FACTORY
// ============================================================================

/**
 * Options for creating an entity adapter
 */
export interface CreateEntityAdapterOptions<TEntity> {
    /** Entity type */
    type: EntityType

    /** Get display name for entity */
    getDisplayName: (entity: TEntity | null) => string

    /** Get label for count (singular/plural) */
    getDisplayLabel?: (count: number) => string

    /** Delete atom from molecule */
    deleteAtom: EntityModalAdapter<TEntity>["deleteAtom"]

    /** Data atom factory from molecule */
    dataAtom: EntityModalAdapter<TEntity>["dataAtom"]

    /** Optional: Icon component */
    getIcon?: () => React.ReactNode

    /** Optional: Can delete check */
    canDelete?: (entity: TEntity | null) => boolean

    /** Optional: Delete warning message */
    getDeleteWarning?: (entity: TEntity | null) => string | null

    /** Optional: Can commit check */
    canCommit?: (entity: TEntity | null) => boolean

    /** Optional: Commit atom from molecule */
    commitAtom?: EntityModalAdapter<TEntity>["commitAtom"]

    /** Optional: Save atom from molecule */
    saveAtom?: EntityModalAdapter<TEntity>["saveAtom"]

    /** Optional: Commit context atom factory for version info, changes summary, diff */
    commitContextAtom?: EntityModalAdapter<TEntity>["commitContextAtom"]
}

/**
 * Create an entity adapter with sensible defaults
 *
 * @param options Adapter options
 * @returns The created adapter
 *
 * @example
 * ```typescript
 * const testsetAdapter = createEntityAdapter({
 *   type: 'testset',
 *   getDisplayName: (testset) => testset?.name ?? 'Untitled Testset',
 *   deleteAtom: testsetMolecule.reducers.delete,
 *   dataAtom: (id) => testsetMolecule.selectors.data(id),
 * })
 * ```
 */
export function createEntityAdapter<TEntity>(
    options: CreateEntityAdapterOptions<TEntity>,
): EntityModalAdapter<TEntity> {
    const {
        type,
        getDisplayName,
        getDisplayLabel,
        deleteAtom,
        dataAtom,
        getIcon,
        canDelete,
        getDeleteWarning,
        canCommit,
        commitAtom,
        saveAtom,
        commitContextAtom,
    } = options

    return {
        type,
        getDisplayName,
        getDisplayLabel:
            getDisplayLabel ?? ((count: number) => getEntityTypeLabel(type, count, "lowercase")),
        deleteAtom,
        dataAtom,
        getIcon,
        canDelete: canDelete ?? (() => true),
        getDeleteWarning,
        canCommit,
        commitAtom,
        saveAtom,
        commitContextAtom,
    }
}

// ============================================================================
// ADAPTER REGISTRATION HELPER
// ============================================================================

/**
 * Create and register an entity adapter in one call
 *
 * @param options Adapter options
 * @returns The created adapter
 *
 * @example
 * ```typescript
 * const testsetAdapter = createAndRegisterEntityAdapter({
 *   type: 'testset',
 *   getDisplayName: (testset) => testset?.name ?? 'Untitled Testset',
 *   deleteAtom: testsetMolecule.reducers.delete,
 *   dataAtom: (id) => testsetMolecule.selectors.data(id),
 * })
 * ```
 */
export function createAndRegisterEntityAdapter<TEntity>(
    options: CreateEntityAdapterOptions<TEntity>,
): EntityModalAdapter<TEntity> {
    const adapter = createEntityAdapter(options)
    registerEntityAdapter(adapter)
    return adapter
}
