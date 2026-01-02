/**
 * Entity Controller Factory
 *
 * Creates a unified API for working with entities that abstracts away the complexity
 * of multiple atoms (entity, draft, query, dirty state, etc.) into a single cohesive interface.
 *
 * ## Problem
 *
 * Without this, consumers need to import and understand 5-10 different atoms:
 * - entityAtomFamily (merged data)
 * - draftAtomFamily (local edits)
 * - queryAtomFamily (loading/error states + server data)
 * - isDirtyAtomFamily (change tracking)
 * - updateAtom, discardAtom (mutations)
 * - etc.
 *
 * ## Solution
 *
 * Single controller atom that provides:
 * - Reactive state (data, serverData, isPending, isError, isDirty)
 * - Dispatch actions (update, discard, setAtPath, deleteAtPath)
 * - All wired up correctly
 * - serverData derived from query.data (single source of truth)
 *
 * ## Usage
 *
 * ```typescript
 * // Define controller once per entity type
 * export const traceSpan = createEntityController({
 *   name: 'traceSpan',
 *   dataAtomFamily: traceSpanEntityAtomFamily,
 *   queryAtomFamily: spanQueryAtomFamily, // single source of truth for server data
 *   isDirtyAtomFamily: traceSpanIsDirtyAtomFamily,
 *   updateAtom: updateTraceSpanAtom,
 *   discardAtom: discardTraceSpanDraftAtom,
 *   drillIn: { ... }, // Optional: enables setAtPath/deleteAtPath
 * })
 *
 * // Use in components
 * function SpanEditor({ spanId }) {
 *   const [state, dispatch] = useAtom(traceSpan.controller(spanId))
 *
 *   if (state.isPending) return <Skeleton />
 *
 *   // Direct update
 *   dispatch({ type: 'update', changes: { name: 'new name' } })
 *
 *   // Path-based update (requires drillIn config)
 *   dispatch({ type: 'setAtPath', path: ['inputs', 'prompt'], value: 'new prompt' })
 *
 *   // Delete at path (requires drillIn config)
 *   dispatch({ type: 'deleteAtPath', path: ['inputs', 'unusedField'] })
 *
 *   // Discard all local changes
 *   dispatch({ type: 'discard' })
 * }
 * ```
 */

import {atom, type Atom, type Getter, type Setter, type WritableAtom} from "jotai"
import {atomFamily} from "jotai/utils"

// ============================================================================
// PATH ITEM TYPE (shared with DrillInView component)
// ============================================================================

/**
 * Represents an item at a navigation level in drill-in view
 */
export interface PathItem {
    /** Unique key for this item (used for navigation) */
    key: string
    /** Display name for this item */
    name: string
    /** The value at this path */
    value: unknown
    /** If true, this item cannot be deleted (e.g., column in testcase) */
    isColumn?: boolean
}

// ============================================================================
// TYPES
// ============================================================================

/**
 * Actions that can be dispatched to the entity controller
 */
export type EntityAction<T> =
    | {type: "update"; changes: Partial<T>}
    | {type: "discard"}
    | {type: "markDeleted"}
    | {type: "restore"}
    // Drill-in actions (only work if drillIn is configured)
    | {type: "setAtPath"; path: string[]; value: unknown}
    | {type: "deleteAtPath"; path: string[]}

/**
 * The state shape returned by the controller
 */
export interface EntityControllerState<T> {
    /** Entity data (server + draft merged). null if not loaded */
    data: T | null
    /** Raw server data without draft. null/undefined if not loaded */
    serverData: T | null | undefined
    /** True while initial fetch is in progress */
    isPending: boolean
    /** True if fetch failed */
    isError: boolean
    /** Error object if fetch failed */
    error: Error | null
    /** True if local changes differ from server */
    isDirty: boolean
    /** True if this is a new entity (not yet on server) */
    isNew: boolean
}

/**
 * Query state shape from TanStack Query atoms
 * This is the single source of truth for server data
 */
export interface QueryState<T = unknown> {
    /** Server data from the query (undefined while loading, null if explicitly null) */
    data: T | null | undefined
    /** True while fetching */
    isPending: boolean
    /** True if fetch failed */
    isError: boolean
    /** Error if fetch failed */
    error: Error | null
}

/**
 * Configuration for creating an entity controller
 */
export interface EntityControllerConfig<T, TDraft = Partial<T>> {
    /** Name of the entity (for debugging) */
    name: string

    /**
     * Entity atom family that provides merged data (server + draft)
     * Used for selectors.data and controller.data
     */
    dataAtomFamily: (id: string) => Atom<T | null>

    /**
     * Query atom family - single source of truth for server data
     * Should return { data, isPending, isError, error }
     * The query handles cache redirect logic for this entity type
     */
    queryAtomFamily: (id: string) => Atom<QueryState<T>>

    /**
     * Dirty state atom family
     * Returns true if entity has local changes
     */
    isDirtyAtomFamily: (id: string) => Atom<boolean>

    /**
     * Update atom - writes changes to draft
     * Signature: (id: string, changes: TDraft) => void
     */
    updateAtom: WritableAtom<null, [string, TDraft], void>

    /**
     * Discard atom - clears draft, reverting to server state
     * Signature: (id: string) => void
     */
    discardAtom: WritableAtom<null, [string], void>

    /**
     * Optional: Check if entity is new (not on server)
     * Defaults to checking if ID starts with 'new-'
     */
    isNewEntity?: (id: string, serverData: T | null | undefined) => boolean

    /**
     * Optional: Additional atoms to read for extended state
     * Values will be spread into the controller state
     */
    extendState?: (
        id: string,
    ) => Atom<Record<string, unknown>>

    /**
     * Optional: Drill-in configuration for path-based navigation and editing
     * If provided, enables drillIn capability on the returned API
     */
    drillIn?: DrillInConfig<T, any>
}

/**
 * The controller atom family type
 * A function that takes an ID and returns an atom with state + dispatch
 */
export type EntityControllerAtomFamily<T> = (
    id: string,
) => WritableAtom<EntityControllerState<T>, [EntityAction<T>], void>

/**
 * Selectors object - provides efficient, fine-grained access to entity state
 * Use these when you only need part of the state (avoids unnecessary re-renders)
 */
export interface EntitySelectors<T> {
    /** Entity data with draft merged (server + local changes) */
    data: (id: string) => Atom<T | null>
    /** Server data only (without draft), extracted from query.data */
    serverData: (id: string) => Atom<T | null | undefined>
    /** True if entity has unsaved local changes */
    isDirty: (id: string) => Atom<boolean>
    /** Query state: data, isPending, isError, error (single source of truth) */
    query: (id: string) => Atom<QueryState<T>>
}

/**
 * Actions object - provides write atoms for in-atom usage
 * Use these when dispatching from other atoms (inside set())
 */
export interface EntityActions<TDraft> {
    /** Update entity with partial changes: set(actions.update, id, changes) */
    update: WritableAtom<null, [string, TDraft], void>
    /** Discard all local changes: set(actions.discard, id) */
    discard: WritableAtom<null, [string], void>
}

// ============================================================================
// DRILL-IN TYPES
// ============================================================================

/**
 * Value mode for drill-in serialization
 * - "string": Values serialized as JSON strings
 * - "native": Values kept as native JS types
 */
export type DrillInValueMode = "string" | "native"

/**
 * Configuration for drill-in capability
 * @template T - Entity type
 * @template TRootData - Type of the root data container (often same as T or a subset)
 */
export interface DrillInConfig<T, TRootData = T> {
    /**
     * Extract the navigable root data from entity
     * @example (testcase) => testcase  // entire entity is navigable
     * @example (span) => span.attributes  // only attributes are navigable
     */
    getRootData: (entity: T) => TRootData

    /**
     * Convert updated root data back to entity update
     * Should return only the fields that changed (partial update)
     * @param entity - Current entity
     * @param rootData - Updated root data
     * @param path - Path that was modified (use path[0] to get top-level key)
     */
    setRootData: (entity: T, rootData: TRootData, path: string[]) => Partial<T>

    /**
     * Generate root-level navigation items
     * For testcases: columns -> PathItems
     * For traces: attribute keys -> PathItems
     */
    getRootItems: (entity: T | null, ...args: unknown[]) => PathItem[]

    /**
     * Value serialization mode
     * - "string": JSON stringify/parse values (legacy)
     * - "native": Keep values as native types (recommended)
     */
    valueMode: DrillInValueMode
}

/**
 * Drill-in API returned as part of EntityAPI
 * Provides path-based navigation and editing for nested data
 */
export interface EntityDrillIn<T> {
    /**
     * Get value at nested path (pure function, use in render)
     * @example drillIn.getValueAtPath(entity, ["inputs", "prompt"])
     */
    getValueAtPath: (entity: T | null, path: string[]) => unknown

    /**
     * Set value at nested path (write atom)
     * @example set(drillIn.setValueAtPathAtom, { id, path: ["inputs"], value: newValue })
     */
    setValueAtPathAtom: WritableAtom<null, [{id: string; path: string[]; value: unknown}], void>

    /**
     * Get root-level items for navigation
     * May accept additional args (e.g., columns for testcase)
     */
    getRootItems: (entity: T | null, ...args: unknown[]) => PathItem[]

    /**
     * Value serialization mode
     */
    valueMode: DrillInValueMode
}

/**
 * Complete entity API returned by createEntityController
 * Provides controller, selectors, actions, and optionally drillIn in one cohesive package
 */
export interface EntityAPI<T, TDraft = Partial<T>> {
    /**
     * Controller atom family for useAtom usage in components
     * @example const [state, dispatch] = useAtom(entity.controller(id))
     */
    controller: EntityControllerAtomFamily<T>

    /**
     * Fine-grained selectors for efficient subscriptions
     * @example const isDirty = useAtomValue(entity.selectors.isDirty(id))
     */
    selectors: EntitySelectors<T>

    /**
     * Write atoms for in-atom usage
     * @example set(entity.actions.update, id, changes)
     */
    actions: EntityActions<TDraft>

    /**
     * Optional: Drill-in capability for path-based navigation and editing
     * Only present if drillIn config was provided
     * @example
     * const value = entity.drillIn.getValueAtPath(data, ["inputs", "prompt"])
     * set(entity.drillIn.setValueAtPathAtom, { id, path, value })
     */
    drillIn?: EntityDrillIn<T>
}

// ============================================================================
// DRILL-IN HELPERS
// ============================================================================

/**
 * Navigate through nested data structure following a path
 * Handles arrays, objects, and JSON string parsing
 */
function navigatePath(data: unknown, path: string[]): unknown {
    let current = data

    for (const key of path) {
        if (current === null || current === undefined) return undefined

        // Try to parse JSON strings before navigating
        if (typeof current === "string") {
            try {
                current = JSON.parse(current)
            } catch {
                // Not valid JSON, can't navigate further
                return undefined
            }
        }

        // Navigate through arrays or objects
        if (Array.isArray(current)) {
            const index = parseInt(key, 10)
            if (isNaN(index) || index < 0 || index >= current.length) return undefined
            current = current[index]
        } else if (typeof current === "object") {
            current = (current as Record<string, unknown>)[key]
        } else {
            return undefined
        }
    }

    return current
}

/**
 * Immutably update nested data structure at path
 * Returns new data with value set at path
 */
function updateAtPath(data: unknown, path: string[], value: unknown): unknown {
    if (path.length === 0) return value

    const [key, ...rest] = path

    // Handle JSON strings - parse, update, re-stringify
    if (typeof data === "string") {
        try {
            const parsed = JSON.parse(data)
            const updated = updateAtPath(parsed, path, value)
            // Preserve formatting if original had it
            const hasFormatting = data.includes("\n") || data.includes("  ")
            return hasFormatting ? JSON.stringify(updated, null, 2) : JSON.stringify(updated)
        } catch {
            // Not valid JSON, can't update
            return data
        }
    }

    // Handle arrays
    if (Array.isArray(data)) {
        const index = parseInt(key, 10)
        if (isNaN(index)) return data
        const newArr = [...data]
        newArr[index] = updateAtPath(data[index], rest, value)
        return newArr
    }

    // Handle objects
    if (typeof data === "object" && data !== null) {
        return {
            ...(data as Record<string, unknown>),
            [key]: updateAtPath((data as Record<string, unknown>)[key], rest, value),
        }
    }

    // Primitive value - can't navigate further, return the new value
    return value
}

/**
 * Immutably delete value at path from nested data structure
 * Removes array elements or object keys
 */
function deleteAtPath(data: unknown, path: string[]): unknown {
    if (path.length === 0) return undefined

    const [key, ...rest] = path

    // Handle JSON strings - parse, delete, re-stringify
    if (typeof data === "string") {
        try {
            const parsed = JSON.parse(data)
            const updated = deleteAtPath(parsed, path)
            const hasFormatting = data.includes("\n") || data.includes("  ")
            return hasFormatting ? JSON.stringify(updated, null, 2) : JSON.stringify(updated)
        } catch {
            return data
        }
    }

    // Handle arrays
    if (Array.isArray(data)) {
        const index = parseInt(key, 10)
        if (isNaN(index)) return data

        if (rest.length === 0) {
            // Delete this element
            return [...data.slice(0, index), ...data.slice(index + 1)]
        }
        // Navigate deeper
        const newArr = [...data]
        newArr[index] = deleteAtPath(data[index], rest)
        return newArr
    }

    // Handle objects
    if (typeof data === "object" && data !== null) {
        if (rest.length === 0) {
            // Delete this key
            const {[key]: _, ...remaining} = data as Record<string, unknown>
            return remaining
        }
        // Navigate deeper
        return {
            ...(data as Record<string, unknown>),
            [key]: deleteAtPath((data as Record<string, unknown>)[key], rest),
        }
    }

    return data
}

/**
 * Serialize value based on mode
 */
function serializeValue(value: unknown, mode: DrillInValueMode): unknown {
    if (mode === "string") {
        if (value === null || value === undefined) return ""
        if (typeof value === "string") return value
        return JSON.stringify(value, null, 2)
    }
    // native mode - return as-is
    return value
}

/**
 * Create drill-in capability for an entity
 * Uses the entity's data and update atoms internally
 */
function createEntityDrillIn<T, TRootData>(
    config: DrillInConfig<T, TRootData>,
    dataAtomFamily: (id: string) => Atom<T | null>,
    updateAtom: WritableAtom<null, [string, Partial<T>], void>,
): EntityDrillIn<T> {
    const {getRootData, setRootData, getRootItems, valueMode} = config

    // Pure function: get value at path
    const getValueAtPath = (entity: T | null, path: string[]): unknown => {
        if (!entity || path.length === 0) {
            return valueMode === "string" ? "" : undefined
        }

        const rootData = getRootData(entity)
        const value = navigatePath(rootData, path)

        return serializeValue(value, valueMode)
    }

    // Write atom: set value at path
    const setValueAtPathAtom = atom(
        null,
        (
            get: Getter,
            set: Setter,
            params: {id: string; path: string[]; value: unknown},
        ) => {
            const {id, path, value} = params
            if (path.length === 0) return

            const entity = get(dataAtomFamily(id))
            if (!entity) return

            const rootData = getRootData(entity)

            // Parse value if it's a JSON string (from string mode editors)
            let parsedValue: unknown = value
            if (typeof value === "string" && valueMode === "native") {
                try {
                    parsedValue = JSON.parse(value)
                } catch {
                    // Keep as string if not valid JSON
                }
            }

            // Update the nested structure
            const updatedRootData = updateAtPath(rootData, path, parsedValue) as TRootData

            // Convert back to entity update
            const updates = setRootData(entity, updatedRootData, path)

            // Use the entity's update atom
            set(updateAtom, id, updates as Partial<T>)
        },
    )

    return {
        getValueAtPath,
        setValueAtPathAtom,
        getRootItems,
        valueMode,
    }
}

// ============================================================================
// FACTORY
// ============================================================================

/**
 * Creates an entity API - a unified API for working with entities
 *
 * Returns an object with:
 * - `controller`: Atom family for useAtom in components (state + dispatch)
 * - `selectors`: Fine-grained atom families for efficient subscriptions
 * - `actions`: Write atoms for in-atom usage
 *
 * @example
 * ```typescript
 * // Define entity API once
 * export const traceSpan = createEntityController({
 *   name: 'traceSpan',
 *   dataAtomFamily: traceSpanEntityAtomFamily,
 *   queryAtomFamily: spanQueryAtomFamily, // single source of truth for server data
 *   isDirtyAtomFamily: traceSpanIsDirtyAtomFamily,
 *   updateAtom: updateTraceSpanAtom,
 *   discardAtom: discardTraceSpanDraftAtom,
 * })
 *
 * // In components - full controller
 * const [state, dispatch] = useAtom(traceSpan.controller(id))
 * dispatch({ type: 'update', changes: { name: 'new name' } })
 *
 * // Efficient selectors - only subscribe to what you need
 * const isDirty = useAtomValue(traceSpan.selectors.isDirty(id))
 * const data = useAtomValue(traceSpan.selectors.data(id))
 *
 * // In other atoms - use actions directly
 * atom(null, (get, set) => {
 *   set(traceSpan.actions.update, id, { name: 'new name' })
 *   set(traceSpan.actions.discard, id)
 * })
 * ```
 */
export function createEntityController<T, TDraft = Partial<T>>(
    config: EntityControllerConfig<T, TDraft>,
): EntityAPI<T, TDraft> {
    const {
        dataAtomFamily,
        queryAtomFamily,
        isDirtyAtomFamily,
        updateAtom,
        discardAtom,
        isNewEntity = (id) => id.startsWith("new-"),
        extendState,
        drillIn: drillInConfig,
    } = config

    // Build drill-in capability if configured
    const drillIn = drillInConfig
        ? createEntityDrillIn(
              drillInConfig,
              dataAtomFamily,
              // Cast to Partial<T> since updateAtom uses TDraft which may be different
              updateAtom as WritableAtom<null, [string, Partial<T>], void>,
          )
        : undefined

    // Build the controller atom family
    const controllerAtomFamily = atomFamily((id: string) =>
        atom(
            // Read function - computes controller state
            (get): EntityControllerState<T> => {
                // Get entity data (server + draft merged)
                const data = get(dataAtomFamily(id))

                // Get query state - single source of truth for server data
                const query = get(queryAtomFamily(id))
                const serverData = query.data

                // Get dirty state
                const isDirty = get(isDirtyAtomFamily(id))

                // Get extended state if configured
                const extended = extendState ? get(extendState(id)) : {}

                return {
                    data,
                    serverData,
                    isPending: query.isPending,
                    isError: query.isError,
                    error: query.error,
                    isDirty,
                    isNew: isNewEntity(id, serverData),
                    ...extended,
                }
            },

            // Write function - dispatches actions
            (get, set, action: EntityAction<T>) => {
                switch (action.type) {
                    case "update":
                        set(updateAtom, id, action.changes as TDraft)
                        break

                    case "discard":
                        set(discardAtom, id)
                        break

                    case "markDeleted":
                        // Optional: implement if entity supports soft delete
                        console.warn(
                            `[${config.name}Controller] markDeleted not implemented`,
                        )
                        break

                    case "restore":
                        // Optional: implement if entity supports restore
                        console.warn(
                            `[${config.name}Controller] restore not implemented`,
                        )
                        break

                    case "setAtPath":
                        if (drillIn) {
                            set(drillIn.setValueAtPathAtom, {
                                id,
                                path: action.path,
                                value: action.value,
                            })
                        } else {
                            console.warn(
                                `[${config.name}Controller] setAtPath requires drillIn config`,
                            )
                        }
                        break

                    case "deleteAtPath":
                        if (drillIn && drillInConfig) {
                            // Delete by setting to undefined and letting the update handle removal
                            const entity = get(dataAtomFamily(id))
                            if (!entity) break

                            const rootData = drillInConfig.getRootData(entity)
                            const updatedRootData = deleteAtPath(
                                rootData,
                                action.path,
                            )
                            const updates = drillInConfig.setRootData(
                                entity,
                                updatedRootData as any,
                                action.path,
                            )
                            set(updateAtom, id, updates as TDraft)
                        } else {
                            console.warn(
                                `[${config.name}Controller] deleteAtPath requires drillIn config`,
                            )
                        }
                        break
                }
            },
        ),
    )

    // Create serverData selector - extracts query.data (single source of truth for server state)
    const serverDataAtomFamily = atomFamily((id: string) =>
        atom((get) => {
            const query = get(queryAtomFamily(id))
            return query.data
        }),
    )

    // Return the full EntityAPI object
    return {
        controller: controllerAtomFamily,

        selectors: {
            data: dataAtomFamily,
            serverData: serverDataAtomFamily,
            isDirty: isDirtyAtomFamily,
            query: queryAtomFamily,
        },

        actions: {
            update: updateAtom,
            discard: discardAtom,
        },

        // Only include drillIn if configured
        ...(drillIn ? {drillIn} : {}),
    }
}

// ============================================================================
// HOOK HELPER (optional, for convenience)
// ============================================================================

/**
 * Type for the hook result - same as useAtom return but typed
 */
export type UseEntityControllerResult<T> = [
    EntityControllerState<T>,
    (action: EntityAction<T>) => void,
]
