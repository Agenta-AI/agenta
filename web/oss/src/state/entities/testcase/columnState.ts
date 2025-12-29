import {atom} from "jotai"
import {atomFamily} from "jotai/utils"

import {currentRevisionIdAtom} from "./queries"
import {
    addColumnToTestcasesAtom,
    deleteColumnFromTestcasesAtom,
    deletedEntityIdsAtom,
    newEntityIdsAtom,
    renameColumnInTestcasesAtom,
    testcaseEntityAtomFamily,
    testcaseIdsAtom,
} from "./testcaseEntity"

// ============================================================================
// COLUMN STATE (REVISION-SCOPED)
// Columns are derived from displayed entity data + local column additions
//
// KEY INSIGHT:
// - Columns = unique keys across all displayed entities + locally added columns
// - Adding a column = adding to localColumnsAtom (entities get property on edit)
// - Removing a column = adding to deletedColumnsAtom
// - Renaming a column = renaming property in all entities via updateTestcaseAtom
// - Column dirty state = comparing current vs server columns
// ============================================================================

// ============================================================================
// PENDING COLUMN RENAMES (REVISION-SCOPED)
// Tracks column renames that need to be applied to newly loaded data
// When page 2 loads after renaming a column on page 1, the server data
// still has the old column name. This map is used to transform the data.
// ============================================================================

/**
 * Map of pending column renames per revision: oldKey → newKey
 * Applied to newly loaded testcases to ensure consistency
 */
export const pendingColumnRenamesAtomFamily = atomFamily((_revisionId: string) =>
    atom<Map<string, string>>(new Map()),
)

/**
 * Derived: pending renames for current revision
 */
export const pendingColumnRenamesAtom = atom((get) => {
    const revisionId = get(currentRevisionIdAtom)
    if (!revisionId) return new Map<string, string>()
    return get(pendingColumnRenamesAtomFamily(revisionId))
})

/**
 * Add a pending column rename to current revision
 */
export const addPendingRenameAtom = atom(
    null,
    (get, set, {oldKey, newKey}: {oldKey: string; newKey: string}) => {
        const revisionId = get(currentRevisionIdAtom)
        if (!revisionId) return

        const current = get(pendingColumnRenamesAtomFamily(revisionId))
        const next = new Map(current)
        // Check if oldKey was itself a rename target (chain renames)
        // e.g., A→B then B→C should result in A→C
        for (const [origKey, targetKey] of next.entries()) {
            if (targetKey === oldKey) {
                next.set(origKey, newKey)
                next.delete(oldKey)
                set(pendingColumnRenamesAtomFamily(revisionId), next)
                return
            }
        }
        next.set(oldKey, newKey)
        set(pendingColumnRenamesAtomFamily(revisionId), next)
    },
)

/**
 * Clear all pending renames for current revision (called after commit/discard)
 */
export const clearPendingRenamesAtom = atom(null, (get, set) => {
    const revisionId = get(currentRevisionIdAtom)
    if (!revisionId) return
    set(pendingColumnRenamesAtomFamily(revisionId), new Map())
})

// ============================================================================
// PENDING COLUMN DELETIONS (REVISION-SCOPED)
// Tracks columns that have been deleted and need to be hidden from newly loaded data
// ============================================================================

export const pendingDeletedColumnsAtomFamily = atomFamily((_revisionId: string) =>
    atom<Set<string>>(new Set()),
)

/**
 * Derived: pending deletions for current revision
 */
export const pendingDeletedColumnsAtom = atom((get) => {
    const revisionId = get(currentRevisionIdAtom)
    if (!revisionId) return new Set<string>()
    return get(pendingDeletedColumnsAtomFamily(revisionId))
})

export const addPendingDeletedColumnAtom = atom(null, (get, set, columnKey: string) => {
    const revisionId = get(currentRevisionIdAtom)
    if (!revisionId) return

    const current = get(pendingDeletedColumnsAtomFamily(revisionId))
    const next = new Set(current)
    next.add(columnKey)
    set(pendingDeletedColumnsAtomFamily(revisionId), next)
})

export const clearPendingDeletedColumnsAtom = atom(null, (get, set) => {
    const revisionId = get(currentRevisionIdAtom)
    if (!revisionId) return
    set(pendingDeletedColumnsAtomFamily(revisionId), new Set())
})

// ============================================================================
// PENDING COLUMN ADDITIONS (REVISION-SCOPED)
// Tracks columns that have been added and need to be initialized in newly loaded data
// ============================================================================

export const pendingAddedColumnsAtomFamily = atomFamily((_revisionId: string) =>
    atom<Set<string>>(new Set()),
)

/**
 * Derived: pending additions for current revision
 */
export const pendingAddedColumnsAtom = atom((get) => {
    const revisionId = get(currentRevisionIdAtom)
    if (!revisionId) return new Set<string>()
    return get(pendingAddedColumnsAtomFamily(revisionId))
})

export const addPendingAddedColumnAtom = atom(null, (get, set, columnKey: string) => {
    const revisionId = get(currentRevisionIdAtom)
    if (!revisionId) return

    const current = get(pendingAddedColumnsAtomFamily(revisionId))
    const next = new Set(current)
    next.add(columnKey)
    set(pendingAddedColumnsAtomFamily(revisionId), next)
})

export const clearPendingAddedColumnsAtom = atom(null, (get, set) => {
    const revisionId = get(currentRevisionIdAtom)
    if (!revisionId) return
    set(pendingAddedColumnsAtomFamily(revisionId), new Set())
})

/**
 * Column type matching useEditableTable interface
 */
export interface Column {
    key: string
    name: string
}

/**
 * System fields to exclude from column derivation
 */
const SYSTEM_FIELDS = new Set([
    "id",
    "key",
    "testset_id",
    "set_id",
    "created_at",
    "updated_at",
    "deleted_at",
    "created_by_id",
    "updated_by_id",
    "deleted_by_id",
    "flags",
    "tags",
    "meta",
    "__isSkeleton",
    "testcase_dedup_id",
    "__dedup_id__",
])

// ============================================================================
// LOCAL COLUMN STATE (REVISION-SCOPED)
// Tracks columns added locally that don't exist in entity data yet
// ============================================================================

/**
 * Locally added columns per revision (columns added but no entity has data yet)
 */
export const localColumnsAtomFamily = atomFamily((_revisionId: string) => atom<Column[]>([]))

/**
 * Deleted columns per revision (columns to hide from display)
 */
export const deletedColumnsAtomFamily = atomFamily((_revisionId: string) =>
    atom<Set<string>>(new Set<string>()),
)

/**
 * Derived: local columns for current revision
 */
export const localColumnsAtom = atom((get) => {
    const revisionId = get(currentRevisionIdAtom)
    if (!revisionId) return []
    return get(localColumnsAtomFamily(revisionId))
})

/**
 * Derived: deleted columns for current revision
 */
export const deletedColumnsAtom = atom((get) => {
    const revisionId = get(currentRevisionIdAtom)
    if (!revisionId) return new Set<string>()
    return get(deletedColumnsAtomFamily(revisionId))
})

// ============================================================================
// COLUMN KEYS FROM DISPLAYED ENTITIES
// Reads from entity atoms via displayRowRefsAtom IDs
// ============================================================================

/**
 * Derived atom: column keys from all displayed entities
 * Reads from testcaseEntityAtomFamily for each ID in testcaseIdsAtom + newEntityIdsAtom
 */
export const currentColumnKeysAtom = atom((get) => {
    const serverIds = get(testcaseIdsAtom)
    const newIds = get(newEntityIdsAtom)
    const deletedIds = get(deletedEntityIdsAtom)

    const keys = new Set<string>()

    // Collect keys from all displayed entities
    const allIds = [...newIds, ...serverIds]
    allIds.forEach((id) => {
        if (deletedIds.has(id)) return

        const entity = get(testcaseEntityAtomFamily(id))
        if (entity) {
            Object.keys(entity).forEach((key) => {
                if (!SYSTEM_FIELDS.has(key)) {
                    keys.add(key)
                }
            })
        }
    })

    return keys
})

/**
 * Derived atom: server column keys (from query atoms, not drafts)
 * Used for detecting column additions/deletions
 */
export const serverColumnKeysAtom = atom((get) => {
    const serverIds = get(testcaseIdsAtom)
    const keys = new Set<string>()

    // Read server state (query data, not drafts) for each ID
    serverIds.forEach((id) => {
        // testcaseEntityAtomFamily returns draft if exists, otherwise server data
        // For server keys, we want the entity data (which includes server state)
        const entity = get(testcaseEntityAtomFamily(id))
        if (entity) {
            Object.keys(entity).forEach((key) => {
                if (!SYSTEM_FIELDS.has(key)) {
                    keys.add(key)
                }
            })
        }
    })

    return keys
})

/**
 * Derived atom: check if there are column schema changes
 * Compares current entity keys vs server snapshot keys
 */
export const hasColumnChangesAtom = atom((get) => {
    const currentKeys = get(currentColumnKeysAtom)
    const serverKeys = get(serverColumnKeysAtom)
    const localCols = get(localColumnsAtom)
    const deletedCols = get(deletedColumnsAtom)

    // Check for locally added columns
    if (localCols.length > 0) return true

    // Check for deleted columns
    if (deletedCols.size > 0) return true

    // Check for added columns (in current but not in server)
    for (const key of currentKeys) {
        if (!serverKeys.has(key)) {
            return true
        }
    }

    // Check for deleted columns (in server but not in current)
    for (const key of serverKeys) {
        if (!currentKeys.has(key)) {
            return true
        }
    }

    return false
})

// ============================================================================
// CURRENT COLUMNS (DERIVED + WRITABLE)
// Combines entity keys + local columns - deleted columns
// Custom getter/setter for local edit support
// ============================================================================

/**
 * Derived atom: current columns as Column[] format
 * This is what the table uses for display
 *
 * Derives columns from:
 * 1. All displayed entities (via testcaseEntityAtomFamily)
 * 2. Locally added columns (explicit column additions)
 * 3. Minus deleted columns
 *
 * No useEffect sync needed - columns derive directly from data.
 */
export const currentColumnsAtom = atom((get) => {
    const entityKeys = get(currentColumnKeysAtom)
    const localCols = get(localColumnsAtom)
    const deletedCols = get(deletedColumnsAtom)

    // Start with entity keys
    const columnMap = new Map<string, Column>()

    // Add columns from entities
    entityKeys.forEach((key) => {
        if (!deletedCols.has(key)) {
            columnMap.set(key, {key, name: key})
        }
    })

    // Add local columns (explicitly added but no data yet)
    localCols.forEach((col) => {
        if (!deletedCols.has(col.key) && !columnMap.has(col.key)) {
            columnMap.set(col.key, col)
        }
    })

    return Array.from(columnMap.values())
})

// ============================================================================
// EXPANDED COLUMNS (DYNAMIC OBJECT EXPANSION)
// Detects object-type columns and expands them into sub-columns
// ============================================================================

/**
 * Information about an expanded column (object property as sub-column)
 */
export interface ExpandedColumn extends Column {
    /** Parent column key (e.g., "event" for "event.type") */
    parentKey: string
    /** Sub-key within the parent object (e.g., "type" for "event.type") */
    subKey: string
}

/**
 * Maximum depth for recursive column expansion
 */
const MAX_COLUMN_DEPTH = 5

/**
 * Try to parse a value as a plain object (handles JSON strings)
 * Arrays are NOT treated as objects - they should be displayed as JSON
 */
function tryParseAsObject(value: unknown): Record<string, unknown> | null {
    // Reject arrays explicitly
    if (Array.isArray(value)) {
        return null
    }
    // Already an object (and not an array)
    if (value && typeof value === "object") {
        return value as Record<string, unknown>
    }
    // Try to parse JSON string - only if it's an object (starts with {), not an array
    if (typeof value === "string") {
        const trimmed = value.trim()
        // Only parse objects, not arrays
        if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
            try {
                const parsed = JSON.parse(trimmed)
                // Double-check it's not an array after parsing
                if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
                    return parsed as Record<string, unknown>
                }
            } catch {
                // Not valid JSON
            }
        }
    }
    return null
}

/**
 * Check if a value is an array (handles JSON strings too)
 */
function isArrayValue(value: unknown): boolean {
    if (Array.isArray(value)) {
        return true
    }
    // Check for JSON array strings
    if (typeof value === "string") {
        const trimmed = value.trim()
        if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
            try {
                const parsed = JSON.parse(trimmed)
                return Array.isArray(parsed)
            } catch {
                return false
            }
        }
    }
    return false
}

/**
 * Recursively collect object sub-keys up to maxDepth levels
 * @param obj - The object to analyze
 * @param prefix - Current path prefix (e.g., "event" or "event.location")
 * @param objectSubKeys - Map to populate with results
 * @param currentDepth - Current recursion depth
 * @param deletedCols - Set of deleted column keys (to filter out deleted paths)
 */
function collectObjectSubKeysRecursive(
    obj: Record<string, unknown>,
    prefix: string,
    objectSubKeys: Map<string, Set<string>>,
    currentDepth: number,
    deletedCols: Set<string>,
): void {
    if (currentDepth >= MAX_COLUMN_DEPTH) return

    Object.entries(obj).forEach(([subKey, subValue]) => {
        const fullPath = prefix ? `${prefix}.${subKey}` : subKey

        // Skip if this path is marked as deleted
        if (deletedCols.has(fullPath)) return

        // Skip array values entirely - they should be displayed as JSON, not expanded
        if (isArrayValue(subValue)) {
            // Add the key but don't recurse into it
            const parentSubKeys = objectSubKeys.get(prefix) || new Set<string>()
            parentSubKeys.add(subKey)
            objectSubKeys.set(prefix, parentSubKeys)
            return
        }

        // Add this subKey to the parent's set
        const parentSubKeys = objectSubKeys.get(prefix) || new Set<string>()
        parentSubKeys.add(subKey)
        objectSubKeys.set(prefix, parentSubKeys)

        // If this value is also an object (not array), recurse
        const nestedObj = tryParseAsObject(subValue)
        if (nestedObj && Object.keys(nestedObj).length > 0) {
            collectObjectSubKeysRecursive(nestedObj, fullPath, objectSubKeys, currentDepth + 1, deletedCols)
        }
    })
}

/**
 * Derived atom: analyzes testcase data to detect object-type columns
 * Returns a map of column key -> set of sub-keys found in that column's objects
 * Handles both actual objects and JSON strings
 * Recursively expands up to MAX_COLUMN_DEPTH levels
 */
export const objectColumnSubKeysAtom = atom((get) => {
    const serverIds = get(testcaseIdsAtom)
    const newIds = get(newEntityIdsAtom)
    const deletedIds = get(deletedEntityIdsAtom)
    const deletedCols = get(deletedColumnsAtom)

    // Map: columnKey (path) -> Set of sub-keys found across all entities
    const objectSubKeys = new Map<string, Set<string>>()

    const allIds = [...newIds, ...serverIds]
    allIds.forEach((id) => {
        if (deletedIds.has(id)) return

        const entity = get(testcaseEntityAtomFamily(id))
        if (!entity) return

        Object.entries(entity).forEach(([key, value]) => {
            if (SYSTEM_FIELDS.has(key)) return
            if (deletedCols.has(key)) return

            // Try to parse as object (handles JSON strings too)
            const obj = tryParseAsObject(value)
            if (obj && Object.keys(obj).length > 0) {
                // Recursively collect sub-keys up to MAX_COLUMN_DEPTH
                // Pass deletedCols to filter out deleted nested paths
                collectObjectSubKeysRecursive(obj, key, objectSubKeys, 1, deletedCols)
            }
        })
    })

    return objectSubKeys
})

/**
 * Recursively expand a column path into sub-columns
 * @param parentPath - The full path to the parent (e.g., "current_rfp" or "current_rfp.event")
 * @param objectSubKeys - Map of path -> sub-keys
 * @param results - Array to push expanded columns into
 */
function expandColumnRecursive(
    parentPath: string,
    objectSubKeys: Map<string, Set<string>>,
    results: (Column | ExpandedColumn)[],
): void {
    const subKeys = objectSubKeys.get(parentPath)

    if (subKeys && subKeys.size > 0) {
        // This path has sub-keys - expand each one
        const sortedSubKeys = Array.from(subKeys).sort()
        sortedSubKeys.forEach((subKey) => {
            const fullPath = `${parentPath}.${subKey}`

            // Check if this sub-key also has nested objects
            const nestedSubKeys = objectSubKeys.get(fullPath)
            if (nestedSubKeys && nestedSubKeys.size > 0) {
                // Recurse into nested object
                expandColumnRecursive(fullPath, objectSubKeys, results)
            } else {
                // Leaf node - add as column
                results.push({
                    key: fullPath,
                    name: subKey, // Only show sub-key name, group name is in header
                    parentKey: parentPath,
                    subKey,
                } as ExpandedColumn)
            }
        })
    }
}

/**
 * Derived atom: expanded columns with object sub-columns
 * Takes base columns and expands object-type columns into grouped sub-columns
 * Recursively expands up to MAX_COLUMN_DEPTH levels
 *
 * Example: If "event" column contains objects with {location: {city, country}},
 * this returns columns: event.location.city, event.location.country
 */
export const expandedColumnsAtom = atom((get) => {
    const baseColumns = get(currentColumnsAtom)
    const objectSubKeys = get(objectColumnSubKeysAtom)

    const expandedColumns: (Column | ExpandedColumn)[] = []

    baseColumns.forEach((col) => {
        const subKeys = objectSubKeys.get(col.key)

        if (subKeys && subKeys.size > 0) {
            // This column contains objects - recursively expand into sub-columns
            expandColumnRecursive(col.key, objectSubKeys, expandedColumns)
        } else {
            // Regular column - keep as is
            expandedColumns.push(col)
        }
    })

    return expandedColumns
})

// ============================================================================
// COLUMN MUTATIONS
// ============================================================================

/**
 * Write-only atom: add a new column
 * Adds column metadata and initializes all entities with empty value
 * Returns true if successful, false if column already exists
 */
export const addColumnAtom = atom(null, (get, set, name: string): boolean => {
    const revisionId = get(currentRevisionIdAtom)
    if (!revisionId) return false

    const trimmedName = name.trim()
    if (!trimmedName) return false

    // Check if column already exists
    const currentCols = get(currentColumnsAtom)
    if (currentCols.some((c) => c.key === trimmedName)) return false

    // Initialize all entities with empty value for this column (batch update)
    // Do this BEFORE adding to pending so entity atom doesn't apply pending changes
    set(addColumnToTestcasesAtom, {columnKey: trimmedName, defaultValue: ""})

    // Track pending addition for newly loaded pages
    set(addPendingAddedColumnAtom, trimmedName)

    // Add to local columns
    const localCols = get(localColumnsAtomFamily(revisionId))
    set(localColumnsAtomFamily(revisionId), [...localCols, {key: trimmedName, name: trimmedName}])

    return true
})

/**
 * Write-only atom: delete a column
 * Marks column as deleted and removes data from all entities
 */
export const deleteColumnAtom = atom(null, (get, set, columnKey: string) => {
    const revisionId = get(currentRevisionIdAtom)
    if (!revisionId) return

    // Remove column data from all entities (batch update)
    // Do this BEFORE adding to pending so entity atom doesn't apply pending changes
    set(deleteColumnFromTestcasesAtom, columnKey)

    // Track pending deletion for newly loaded pages
    set(addPendingDeletedColumnAtom, columnKey)

    // Add to deleted columns
    const deletedCols = get(deletedColumnsAtomFamily(revisionId))
    const newDeleted = new Set(deletedCols)
    newDeleted.add(columnKey)
    set(deletedColumnsAtomFamily(revisionId), newDeleted)

    // Also remove from local columns if it was added locally
    const localCols = get(localColumnsAtomFamily(revisionId))
    set(
        localColumnsAtomFamily(revisionId),
        localCols.filter((c) => c.key !== columnKey),
    )
})

/**
 * Write-only atom: rename a column
 * Renames the property in all entities using batch update to avoid N re-renders
 * Also tracks the rename so newly loaded pages get the rename applied
 * Returns true if successful, false if new name already exists
 *
 * @param oldName - The current column name
 * @param newName - The new column name
 * @param rowDataMap - Optional map of testcase ID to row data (for server rows without drafts)
 */
export const renameColumnAtom = atom(
    null,
    (
        get,
        set,
        {
            oldName,
            newName,
            rowDataMap,
        }: {oldName: string; newName: string; rowDataMap?: Map<string, Record<string, unknown>>},
    ): boolean => {
        const revisionId = get(currentRevisionIdAtom)
        if (!revisionId) return false

        const trimmedNewName = newName.trim()
        if (!trimmedNewName) return false
        if (oldName === trimmedNewName) return true

        // Check if new name already exists
        const currentCols = get(currentColumnsAtom)
        if (currentCols.some((c) => c.key === trimmedNewName && c.key !== oldName)) return false

        // IMPORTANT: Rename in entities BEFORE adding pending rename
        // Otherwise testcaseEntityAtomFamily applies pending rename and oldKey won't be found
        set(renameColumnInTestcasesAtom, {oldKey: oldName, newKey: trimmedNewName, rowDataMap})

        // Track pending rename for newly loaded pages (after entity update)
        set(addPendingRenameAtom, {oldKey: oldName, newKey: trimmedNewName})

        // Rename in local columns if it was added locally
        const localCols = get(localColumnsAtomFamily(revisionId))
        set(
            localColumnsAtomFamily(revisionId),
            localCols.map((c) =>
                c.key === oldName ? {key: trimmedNewName, name: trimmedNewName} : c,
            ),
        )

        return true
    },
)

/**
 * Write-only atom: reset column state for current revision
 * Clears local columns and deleted columns
 */
export const resetColumnsAtom = atom(null, (get, set) => {
    const revisionId = get(currentRevisionIdAtom)
    if (!revisionId) return

    set(localColumnsAtomFamily(revisionId), [])
    set(deletedColumnsAtomFamily(revisionId), new Set<string>())
})
