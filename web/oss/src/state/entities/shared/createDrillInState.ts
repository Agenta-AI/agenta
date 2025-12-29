import {atom, type Atom, type Getter, type Setter, type WritableAtom} from "jotai"
import {atomFamily} from "jotai/utils"

import type {PathItem} from "@/oss/components/DrillInView"

// ============================================================================
// TYPES
// ============================================================================

/**
 * Value mode for drill-in operations
 * - string: Values are serialized as JSON strings (testcase columns)
 * - native: Values are kept as-is (trace attributes)
 */
export type DrillInValueMode = "string" | "native"

/**
 * Configuration for creating drill-in state
 */
export interface DrillInStateConfig<TEntity, TRootData> {
    /**
     * Extract the root data container from the entity
     * For testcase: (entity) => entity (entire entity is navigable)
     * For trace: (entity) => entity.attributes (only attributes are navigable)
     */
    getRootData: (entity: TEntity) => TRootData

    /**
     * Generate root items for navigation
     * For testcase: Map columns to PathItems
     * For trace: Map attribute keys to PathItems
     * Should handle null entity gracefully (return empty array)
     */
    getRootItems: (entity: TEntity | null) => PathItem[]

    /**
     * Update atom from entity's mutation system
     * This atom handles creating/updating drafts
     */
    updateAtom: WritableAtom<null, [{id: string; updates: Partial<TEntity>}], void>

    /**
     * How to set updated root data back into the entity
     * For testcase: (entity, {columnKey: value}) => ({...entity, columnKey: value})
     * For trace: (entity, attrs) => ({...entity, attributes: attrs})
     *
     * IMPORTANT: Should return only the fields that changed, not the entire entity
     * Use the path parameter to extract only the top-level field that was modified
     */
    setRootData: (entity: TEntity, rootData: TRootData, path: string[]) => Partial<TEntity>

    /**
     * Value mode for serialization
     * - string: Always return strings (testcase)
     * - native: Return native values (trace)
     */
    valueMode: DrillInValueMode

    /**
     * Entity atom family that includes draft state
     * For testcase: testcaseEntityAtomFamily
     * For trace: traceSpanWithDraftAtomFamily
     */
    entityAtomFamily: (id: string) => Atom<TEntity | null>
}

/**
 * Return type from createDrillInState factory
 */
export interface DrillInState<TEntity, TRootData> {
    /**
     * Pure function: Get value at path from entity
     */
    getValueAtPath: (entity: TEntity | null, path: string[]) => unknown

    /**
     * Pure function: Get root items for navigation
     * Accepts null for consistency with other helpers
     */
    getRootItems: (entity: TEntity | null) => PathItem[]

    /**
     * Atom: Set value at path (creates/updates draft)
     */
    setValueAtPathAtom: WritableAtom<
        null,
        [{id: string; path: string[]; value: unknown}],
        void
    >

    /**
     * Atom family: Current navigation path for an entity instance
     */
    currentPathAtomFamily: (id: string) => Atom<string[]>

    /**
     * Atom family: Collapsed fields state for an entity instance
     */
    collapsedFieldsAtomFamily: (id: string) => Atom<Record<string, boolean>>

    /**
     * Atom family: Raw mode fields state for an entity instance
     */
    rawModeFieldsAtomFamily: (id: string) => Atom<Record<string, boolean>>
}

// ============================================================================
// SHARED UTILITIES
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

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

/**
 * Create drill-in state management for an entity
 *
 * This factory generates path-based navigation and editing capabilities
 * for nested data structures.
 *
 * @example
 * ```typescript
 * // For testcase entity (column-based, string mode)
 * const testcaseDrillIn = createDrillInState<FlattenedTestcase, FlattenedTestcase>({
 *   getRootData: (entity) => entity,
 *   getRootItems: (entity) => columns.map(col => ({...})),
 *   updateAtom: updateTestcaseAtom,
 *   setRootData: (entity, data) => data,
 *   valueMode: 'string',
 *   entityAtomFamily: testcaseEntityAtomFamily
 * })
 *
 * // For trace entity (attributes-based, native mode)
 * const traceDrillIn = createDrillInState<TraceSpan, TraceSpanAttributes>({
 *   getRootData: (span) => span.attributes || {},
 *   getRootItems: (span) => Object.keys(span.attributes || {}).map(key => ({...})),
 *   updateAtom: updateTraceSpanAtom,
 *   setRootData: (span, attrs) => ({attributes: attrs}),
 *   valueMode: 'native',
 *   entityAtomFamily: traceSpanWithDraftAtomFamily
 * })
 * ```
 */
export function createDrillInState<TEntity, TRootData>(
    config: DrillInStateConfig<TEntity, TRootData>,
): DrillInState<TEntity, TRootData> {
    const {getRootData, getRootItems, updateAtom, setRootData, valueMode, entityAtomFamily} =
        config

    // ========================================================================
    // READ HELPER (Pure function)
    // ========================================================================

    /**
     * Get value at path from entity
     * Pure function - can be called synchronously in render
     */
    const getValueAtPath = (entity: TEntity | null, path: string[]): unknown => {
        if (!entity || path.length === 0) {
            return valueMode === "string" ? "" : undefined
        }

        const rootData = getRootData(entity)
        const value = navigatePath(rootData, path)

        return serializeValue(value, valueMode)
    }

    // ========================================================================
    // WRITE ATOM (Mutation)
    // ========================================================================

    /**
     * Set value at path for an entity
     * Creates/updates draft through entity's update atom
     */
    const setValueAtPathAtom = atom(
        null,
        (
            get: Getter,
            set: Setter,
            params: {
                id: string
                path: string[]
                value: unknown
            },
        ) => {
            const {id, path, value} = params
            if (path.length === 0) return

            const entity = get(entityAtomFamily(id))
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
            // Pass the path so setRootData can extract only the changed field
            const updates = setRootData(entity, updatedRootData, path)

            set(updateAtom, {id, updates})
        },
    )

    // ========================================================================
    // UI STATE ATOMS (Per entity instance)
    // ========================================================================

    /**
     * Current drill-in path for an entity instance
     */
    const currentPathAtomFamily = atomFamily((id: string) => atom<string[]>([]))

    /**
     * Collapsed fields state for an entity instance
     */
    const collapsedFieldsAtomFamily = atomFamily((id: string) =>
        atom<Record<string, boolean>>({}),
    )

    /**
     * Raw mode fields state for an entity instance
     */
    const rawModeFieldsAtomFamily = atomFamily((id: string) => atom<Record<string, boolean>>({}))

    /**
     * Wrapped getRootItems that handles null entities
     */
    const getRootItemsWrapper = (entity: TEntity | null): PathItem[] => {
        if (!entity) return []
        return getRootItems(entity)
    }

    return {
        getValueAtPath,
        getRootItems: getRootItemsWrapper,
        setValueAtPathAtom,
        currentPathAtomFamily,
        collapsedFieldsAtomFamily,
        rawModeFieldsAtomFamily,
    }
}
