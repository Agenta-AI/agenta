/**
 * Entity Data Controller Factory
 *
 * Creates a unified API for entity data access that abstracts the data source.
 * This is a generalization of the `testcaseDataController` pattern — it produces
 * selection atoms, derived selectors, and action atoms automatically.
 *
 * Entity modules only need to provide how to get rows, loading state, and columns.
 * The factory handles selection management, derived counts, and cleanup.
 *
 * ## Memory Management
 *
 * Controllers use `atomFamily` for per-scope selection state. Consumers MUST call
 * `resetSelection` when a scope is destroyed to prevent memory leaks:
 *
 * ```typescript
 * useEffect(() => {
 *   return () => resetSelection(config.scopeId)
 * }, [config.scopeId])
 * ```
 *
 * Additionally, configs passed to selectors should be memoized to avoid creating
 * new atom instances on every render.
 *
 * @example
 * ```typescript
 * import { createEntityDataController, type EntityColumnDef } from '@agenta/entities/shared'
 *
 * const myDataController = createEntityDataController<MyRow, MyConfig>({
 *   rows: (config) => atom((get) => {
 *     if (config.useLocal) return get(localRowsAtom)
 *     return get(paginatedStore.selectors.state(config)).rows
 *   }),
 *   isLoading: (config) => atom((get) => {
 *     if (config.useLocal) return false
 *     return get(paginatedStore.selectors.state(config)).isFetching
 *   }),
 *   columns: (config) => atom((get) => {
 *     const rows = get(myDataController.selectors.rows(config))
 *     return extractColumnsFromData(rows)
 *   }),
 *   configEquals: (a, b) => a.scopeId === b.scopeId && a.revisionId === b.revisionId,
 * })
 * ```
 *
 * @module createEntityDataController
 */

import {atom, type Atom, type PrimitiveAtom, type WritableAtom} from "jotai"
import {atomFamily} from "jotai-family"

import type {EntityListCounts, GroupableColumn} from "./tableTypes"

// ============================================================================
// TYPES
// ============================================================================

/**
 * Column definition for entity tables.
 *
 * Extends `GroupableColumn` from `@agenta/ui` with optional entity-specific
 * properties. This type is compatible with the `groupColumns` utility.
 *
 * @example
 * ```typescript
 * const columns: EntityColumnDef[] = [
 *   { key: 'name', label: 'Name' },
 *   { key: 'inputs.prompt', label: 'prompt', parentKey: 'inputs', width: 200 },
 *   { key: 'expected_output', label: 'Expected Output' },
 * ]
 * ```
 */
export interface EntityColumnDef extends GroupableColumn {
    /** Column width in pixels */
    width?: number
    /** Whether the column is sortable */
    sortable?: boolean
    /** Whether the column was added locally (not from server) */
    isLocal?: boolean
}

/**
 * Base row shape required by the data controller.
 *
 * All row types must have at least `id` and `key` fields.
 * Additional fields (like `__isSkeleton`, `__isNew`) are optional
 * and handled by specific entity implementations.
 */
export interface EntityRowBase {
    id: string
    key: string
    [key: string]: unknown
}

/**
 * Base config shape required by the data controller.
 *
 * All config types must have at least `scopeId` for scoping selection state.
 */
export interface EntityDataConfigBase {
    scopeId: string
}

/**
 * Configuration for creating an entity data controller.
 *
 * Provides the entity-specific functions that the factory uses to build
 * the unified controller API.
 *
 * @template TRow - Row type (must have id and key)
 * @template TConfig - Config type (must have scopeId)
 * @template TColumn - Column type (must extend GroupableColumn)
 */
export interface CreateEntityDataControllerConfig<
    TRow extends EntityRowBase,
    TConfig extends EntityDataConfigBase,
    TColumn extends EntityColumnDef = EntityColumnDef,
> {
    /**
     * Produce row data atoms from config.
     *
     * For server-mode: read from paginated store.
     * For local-mode: read from molecule or provided rows.
     */
    rows: (config: TConfig) => Atom<TRow[]>

    /**
     * Produce loading state atoms from config.
     */
    isLoading: (config: TConfig) => Atom<boolean>

    /**
     * Produce column definition atoms from config.
     *
     * Prefer revision-level columns when available;
     * fall back to extracting from row data.
     */
    columns: (config: TConfig) => Atom<TColumn[]>

    /**
     * Custom equality function for config comparison.
     *
     * Used by `atomFamily` to determine if two configs produce the same atom.
     * Must compare all fields that affect data fetching (not just scopeId).
     */
    configEquals: (a: TConfig, b: TConfig) => boolean

    /**
     * Optional: Produce list counts atoms from config.
     *
     * When provided, enables count-related selectors on the controller.
     * Typically reads from paginated store's listCounts selector.
     */
    counts?: (config: TConfig) => Atom<EntityListCounts>
}

/**
 * Unified entity data controller produced by the factory.
 *
 * Provides selectors for reading data and actions for modifying selection state.
 *
 * @template TRow - Row type
 * @template TConfig - Config type
 * @template TColumn - Column type
 */
export interface EntityDataController<
    TRow extends EntityRowBase,
    TConfig extends EntityDataConfigBase,
    TColumn extends EntityColumnDef = EntityColumnDef,
> {
    /** Selectors for reading data (return Jotai atoms for reactive subscriptions) */
    selectors: {
        /** Get rows from configured data source */
        rows: (config: TConfig) => Atom<TRow[]>
        /** Check if data is loading */
        isLoading: (config: TConfig) => Atom<boolean>
        /** Get column definitions */
        columns: (config: TConfig) => Atom<TColumn[]>
        /** Get all row IDs */
        allRowIds: (config: TConfig) => Atom<string[]>
        /** Get total row count */
        totalCount: (config: TConfig) => Atom<number>
        /** Get selected IDs as Set (for efficient lookup) */
        selectedIds: (scopeId: string) => Atom<Set<string>>
        /** Get selected IDs as array */
        selectedIdsArray: (scopeId: string) => Atom<string[]>
        /** Get selected count */
        selectedCount: (scopeId: string) => Atom<number>
        /** Check if all rows are selected */
        isAllSelected: (config: TConfig) => Atom<boolean>
        /** Check if some (but not all) rows are selected */
        isSomeSelected: (config: TConfig) => Atom<boolean>
        /**
         * Get list counts summary (if counts source is configured).
         * Returns null atom if counts source is not provided.
         */
        listCounts: (config: TConfig) => Atom<EntityListCounts | null>
        /** Get display label from list counts (convenience selector) */
        displayLabel: (config: TConfig) => Atom<string>
        /** Get hasMore from list counts (convenience selector) */
        hasMore: (config: TConfig) => Atom<boolean>
        /** Get loadedCount from list counts (convenience selector) */
        loadedCount: (config: TConfig) => Atom<number>
    }

    /** Actions for modifying selection state (write-only Jotai atoms) */
    actions: {
        /** Set selection for a scope: (scopeId, ids) */
        setSelection: WritableAtom<null, [string, string[]], void>
        /** Toggle a single item selection: (scopeId, itemId, multiSelect?) */
        toggleSelection: WritableAtom<null, [string, string, boolean?], void>
        /** Select all items: (scopeId, allIds) */
        selectAll: WritableAtom<null, [string, string[]], void>
        /** Clear selection for a scope: (scopeId) */
        clearSelection: WritableAtom<null, [string], void>
        /** Reset selection for a scope (removes from cache): (scopeId) */
        resetSelection: WritableAtom<null, [string], void>
    }
}

// ============================================================================
// FACTORY
// ============================================================================

/**
 * Create a unified entity data controller.
 *
 * Extracts the reusable selection, derived selectors, and action atom patterns
 * from entity-specific data controllers into a generic factory.
 *
 * @template TRow - Row type (must extend EntityRowBase)
 * @template TConfig - Config type (must extend EntityDataConfigBase)
 * @template TColumn - Column type (must extend EntityColumnDef)
 *
 * @param factoryConfig - Entity-specific configuration for rows, loading, columns, and equality
 * @returns A fully-formed EntityDataController with selectors and actions
 *
 * @example
 * ```typescript
 * const testcaseDataController = createEntityDataController<TestcaseTableRow, TestcaseDataConfig>({
 *   rows: (config) => rowsAtomFamily(config),
 *   isLoading: (config) => isLoadingAtomFamily(config),
 *   columns: (config) => columnsAtomFamily(config),
 *   configEquals: areConfigsEqual,
 * })
 * ```
 */
export function createEntityDataController<
    TRow extends EntityRowBase,
    TConfig extends EntityDataConfigBase,
    TColumn extends EntityColumnDef = EntityColumnDef,
>(
    factoryConfig: CreateEntityDataControllerConfig<TRow, TConfig, TColumn>,
): EntityDataController<TRow, TConfig, TColumn> {
    const {
        rows: rowsFn,
        isLoading: isLoadingFn,
        columns: columnsFn,
        configEquals,
        counts: countsFn,
    } = factoryConfig

    // ========================================================================
    // SELECTION STATE (per-scope, managed by atomFamily)
    // ========================================================================

    const selectionFamily = atomFamily(
        (_scopeId: string) => atom<Set<string>>(new Set<string>()) as PrimitiveAtom<Set<string>>,
    )

    const setSelectionAtom = atom(null, (_get, set, scopeId: string, selectedIds: string[]) => {
        set(selectionFamily(scopeId), new Set(selectedIds))
    })

    const toggleSelectionAtom = atom(
        null,
        (get, set, scopeId: string, itemId: string, multiSelect = true) => {
            const current = get(selectionFamily(scopeId))
            const newSet = new Set(current)

            if (multiSelect) {
                if (newSet.has(itemId)) {
                    newSet.delete(itemId)
                } else {
                    newSet.add(itemId)
                }
            } else {
                newSet.clear()
                if (!current.has(itemId)) {
                    newSet.add(itemId)
                }
            }

            set(selectionFamily(scopeId), newSet)
        },
    )

    const selectAllAtom = atom(null, (_get, set, scopeId: string, allIds: string[]) => {
        set(selectionFamily(scopeId), new Set(allIds))
    })

    const clearSelectionAtom = atom(null, (_get, set, scopeId: string) => {
        set(selectionFamily(scopeId), new Set<string>())
    })

    const resetSelectionAtom = atom(null, (_get, _set, scopeId: string) => {
        selectionFamily.remove(scopeId)
    })

    // ========================================================================
    // DERIVED SELECTORS (config-scoped)
    // ========================================================================

    const allRowIdsFamily = atomFamily((config: TConfig) => {
        return atom((get): string[] => {
            const r = get(rowsFn(config))
            return r.map((row) => row.id)
        })
    }, configEquals)

    const totalCountFamily = atomFamily((config: TConfig) => {
        return atom((get): number => {
            const r = get(rowsFn(config))
            return r.length
        })
    }, configEquals)

    const selectedIdsArrayFamily = atomFamily((scopeId: string) => {
        return atom((get): string[] => {
            const selection = get(selectionFamily(scopeId))
            return [...selection]
        })
    })

    const selectedCountFamily = atomFamily((scopeId: string) => {
        return atom((get): number => {
            const selection = get(selectionFamily(scopeId))
            return selection.size
        })
    })

    const isAllSelectedFamily = atomFamily((config: TConfig) => {
        return atom((get): boolean => {
            const allIds = get(allRowIdsFamily(config))
            const selection = get(selectionFamily(config.scopeId))
            return allIds.length > 0 && allIds.every((id) => selection.has(id))
        })
    }, configEquals)

    const isSomeSelectedFamily = atomFamily((config: TConfig) => {
        return atom((get): boolean => {
            const allIds = get(allRowIdsFamily(config))
            const selection = get(selectionFamily(config.scopeId))
            const selectedCount = allIds.filter((id) => selection.has(id)).length
            return selectedCount > 0 && selectedCount < allIds.length
        })
    }, configEquals)

    // ========================================================================
    // LIST COUNTS SELECTORS
    // ========================================================================

    // Null counts for when counts source is not provided
    const nullCountsAtom = atom((): EntityListCounts | null => null)

    const listCountsFamily = atomFamily((config: TConfig) => {
        if (!countsFn) {
            return nullCountsAtom
        }
        return atom((get): EntityListCounts | null => get(countsFn(config)))
    }, configEquals)

    const displayLabelFamily = atomFamily((config: TConfig) => {
        return atom((get): string => {
            const counts = get(listCountsFamily(config))
            if (!counts) {
                // Fallback to row count when counts source is not provided
                const rows = get(rowsFn(config))
                return String(rows.length)
            }
            return counts.displayLabel
        })
    }, configEquals)

    const hasMoreFamily = atomFamily((config: TConfig) => {
        return atom((get): boolean => {
            const counts = get(listCountsFamily(config))
            return counts?.hasMore ?? false
        })
    }, configEquals)

    const loadedCountFamily = atomFamily((config: TConfig) => {
        return atom((get): number => {
            const counts = get(listCountsFamily(config))
            if (!counts) {
                // Fallback to row count when counts source is not provided
                const rows = get(rowsFn(config))
                return rows.length
            }
            return counts.loadedCount
        })
    }, configEquals)

    // ========================================================================
    // CONTROLLER API
    // ========================================================================

    return {
        selectors: {
            rows: (config: TConfig): Atom<TRow[]> => rowsFn(config),
            isLoading: (config: TConfig): Atom<boolean> => isLoadingFn(config),
            columns: (config: TConfig): Atom<TColumn[]> => columnsFn(config),
            allRowIds: (config: TConfig): Atom<string[]> => allRowIdsFamily(config),
            totalCount: (config: TConfig): Atom<number> => totalCountFamily(config),
            selectedIds: (scopeId: string): Atom<Set<string>> => selectionFamily(scopeId),
            selectedIdsArray: (scopeId: string): Atom<string[]> => selectedIdsArrayFamily(scopeId),
            selectedCount: (scopeId: string): Atom<number> => selectedCountFamily(scopeId),
            isAllSelected: (config: TConfig): Atom<boolean> => isAllSelectedFamily(config),
            isSomeSelected: (config: TConfig): Atom<boolean> => isSomeSelectedFamily(config),
            listCounts: (config: TConfig): Atom<EntityListCounts | null> =>
                listCountsFamily(config),
            displayLabel: (config: TConfig): Atom<string> => displayLabelFamily(config),
            hasMore: (config: TConfig): Atom<boolean> => hasMoreFamily(config),
            loadedCount: (config: TConfig): Atom<number> => loadedCountFamily(config),
        },
        actions: {
            setSelection: setSelectionAtom,
            toggleSelection: toggleSelectionAtom,
            selectAll: selectAllAtom,
            clearSelection: clearSelectionAtom,
            resetSelection: resetSelectionAtom,
        },
    }
}
