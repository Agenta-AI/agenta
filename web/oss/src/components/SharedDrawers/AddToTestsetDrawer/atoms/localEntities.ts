import {atom} from "jotai"

import {localEntitiesRevisionAtom} from "@/oss/state/entities/testcase/atomCleanup"
import {
    addPendingAddedColumnAtom,
    addPendingDeletedColumnAtom,
    clearPendingAddedColumnsAtom,
    clearPendingDeletedColumnsAtom,
    currentColumnsAtom,
    localColumnsAtomFamily,
} from "@/oss/state/entities/testcase/columnState"
import {deleteTestcasesAtom} from "@/oss/state/entities/testcase/mutations"
import type {FlattenedTestcase} from "@/oss/state/entities/testcase/schema"
import {
    addNewEntityIdAtom,
    newEntityIdsAtom,
    testcaseDraftAtomFamily,
    testcaseEntityAtomFamily,
    updateTestcaseAtom,
} from "@/oss/state/entities/testcase/testcaseEntity"
import {currentRevisionIdAtom} from "@/oss/state/entities/testset"

import type {TestsetTraceData} from "../assets/types"

import {localColumnsAtom, selectedRevisionIdAtom as drawerRevisionIdAtom} from "./drawerState"
import {selectedTestsetIdAtom} from "./testsetQueries"

/**
 * Local Entities Management
 *
 * Handles creation and updates of local testcase entities in the drawer.
 * - Local entities are created ONCE when a revision is selected
 * - Mapping changes UPDATE existing local entities (not recreate)
 */

// ============================================================================
// LOCAL ENTITY IDS TRACKING
// ============================================================================

/**
 * IDs of local entities created for this drawer session
 * Maps trace key -> entity ID for easy lookup
 */
export const localEntityMapAtom = atom<Map<string, string>>(new Map())

/**
 * Track which revision we've created entities for (to prevent re-creation loops)
 */
export const localEntitiesCreatedForRevisionAtom = atom<string | null>(null)

/**
 * Derived: Array of local entity IDs
 */
export const localEntityIdsAtom = atom((get) => {
    const map = get(localEntityMapAtom)
    return Array.from(map.values())
})

// ============================================================================
// CREATE LOCAL ENTITIES (ONCE)
// ============================================================================

/**
 * Write-only atom: Create local entities for trace data
 *
 * Called ONCE when a revision is selected. Creates one entity per trace item.
 * Each entity is initialized with current columns (empty values).
 *
 * Usage:
 *   const createLocalEntities = useSetAtom(createLocalEntitiesAtom)
 *   createLocalEntities(traceData)
 */
export const createLocalEntitiesAtom = atom(
    null,
    (
        get,
        set,
        {
            traceData,
            mappings,
            getValueAtPath,
            isNewTestset = false,
        }: {
            traceData: TestsetTraceData[]
            mappings: {data: string; column: string; newColumn?: string}[]
            getValueAtPath: (obj: any, path: string) => any
            isNewTestset?: boolean
        },
    ) => {
        // Set revision context first
        const revisionId = get(drawerRevisionIdAtom)
        const alreadyCreatedFor = get(localEntitiesCreatedForRevisionAtom)

        // For new testsets, allow "draft" revision; otherwise require valid revision
        if (!revisionId) {
            return
        }
        if (revisionId === "draft" && !isNewTestset) {
            return
        }

        // Prevent re-creation for the same revision (avoids infinite loops)
        if (alreadyCreatedFor === revisionId) {
            return
        }

        set(currentRevisionIdAtom, revisionId)
        set(localEntitiesCreatedForRevisionAtom, revisionId)

        // Clear any existing local entities first
        const existingMap = get(localEntityMapAtom)
        if (existingMap.size > 0) {
            set(deleteTestcasesAtom, Array.from(existingMap.values()))
            set(localEntityMapAtom, new Map())
        }

        // Clear ALL new entities (both local- and new- prefixed)
        // This handles stale local entities AND entities created by initializeEmptyRevisionAtom
        const newEntityIds = get(newEntityIdsAtom)
        if (newEntityIds.length > 0) {
            set(deleteTestcasesAtom, newEntityIds)
        }

        // Clear pending column changes first
        set(clearPendingAddedColumnsAtom)
        set(clearPendingDeletedColumnsAtom)

        // Get current columns from server data BEFORE we modify anything
        const existingColumns = get(currentColumnsAtom)
        const testsetId = get(selectedTestsetIdAtom) || ""

        // Build set of mapped column keys
        // NOTE: We do NOT call addColumnAtom here because that would add the column
        // to ALL testcases (including fetched ones from backend), causing them to
        // show as "changed". Instead, we only track columns locally and apply
        // data directly to local entities.
        const mappedColumnKeys = new Set<string>()
        for (const mapping of mappings) {
            const targetColumn =
                mapping.column === "create" || !mapping.column ? mapping.newColumn : mapping.column

            if (targetColumn) {
                mappedColumnKeys.add(targetColumn)
            }
        }

        // Hide columns from server data that are NOT in our mappings
        for (const col of existingColumns) {
            if (!mappedColumnKeys.has(col.key)) {
                set(addPendingDeletedColumnAtom, col.key)
            }
        }

        // Create one entity per trace item WITH mapped data
        const newMap = new Map<string, string>()

        traceData.forEach((trace, index) => {
            const entityId = `local-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 7)}`

            // Build data from mappings
            const mappedData: Record<string, string> = {}
            for (const mapping of mappings) {
                const targetColumn =
                    mapping.column === "create" || !mapping.column
                        ? mapping.newColumn
                        : mapping.column

                if (!targetColumn) continue

                const value = getValueAtPath(trace, mapping.data)
                // Preserve objects/arrays as-is, only convert null/undefined to empty string
                mappedData[targetColumn] = value === undefined || value === null ? "" : value
            }

            // Initialize with mapped data only (no extra columns)
            const flattenedRow: FlattenedTestcase = {
                id: entityId,
                testset_id: testsetId,
                ...mappedData,
            }

            // Register as new entity
            set(addNewEntityIdAtom, entityId)
            // Create draft with initial data INCLUDING mapped values
            set(testcaseDraftAtomFamily(entityId), flattenedRow)

            // Track mapping: trace.key -> entityId
            newMap.set(trace.key, entityId)
        })

        set(localEntityMapAtom, newMap)
    },
)

// ============================================================================
// UPDATE LOCAL ENTITY COLUMN
// ============================================================================

/**
 * Write-only atom: Update a column value on a local entity
 *
 * Called when mapping changes. Updates the specified column on the entity
 * associated with the given trace key.
 *
 * Usage:
 *   const updateLocalEntity = useSetAtom(updateLocalEntityColumnAtom)
 *   updateLocalEntity({ traceKey: 'span-1', column: 'input', value: 'hello' })
 */
export const updateLocalEntityColumnAtom = atom(
    null,
    (get, set, {traceKey, column, value}: {traceKey: string; column: string; value: string}) => {
        const entityMap = get(localEntityMapAtom)
        const entityId = entityMap.get(traceKey)

        if (!entityId) {
            console.warn(`⚠️ [LocalEntities] No entity found for trace key: ${traceKey}`)
            return
        }

        set(updateTestcaseAtom, {
            id: entityId,
            updates: {[column]: value},
        })
    },
)

/**
 * Write-only atom: Bulk update all local entities with mapped data
 *
 * Called when mappings change. Updates all local entities based on
 * the current mapping configuration.
 *
 * Usage:
 *   const updateAllLocalEntities = useSetAtom(updateAllLocalEntitiesAtom)
 *   updateAllLocalEntities({ traceData, mappings, getValueAtPath })
 */
export const updateAllLocalEntitiesAtom = atom(
    null,
    (
        get,
        set,
        {
            traceData,
            mappings,
            getValueAtPath,
        }: {
            traceData: TestsetTraceData[]
            mappings: {data: string; column: string; newColumn?: string}[]
            getValueAtPath: (obj: any, path: string) => any
        },
    ) => {
        const entityMap = get(localEntityMapAtom)
        const revisionId = get(drawerRevisionIdAtom)

        console.log("[updateAllLocalEntitiesAtom] Called", {
            traceDataLength: traceData.length,
            mappingsCount: mappings.length,
            entityMapSize: entityMap.size,
            revisionId,
        })

        if (entityMap.size === 0) {
            console.log("[updateAllLocalEntitiesAtom] No entities in map, returning early")
            return
        }

        // Get the set of columns that are currently mapped
        const mappedColumns = new Set<string>()
        for (const mapping of mappings) {
            const targetColumn =
                mapping.column === "create" || !mapping.column ? mapping.newColumn : mapping.column
            if (targetColumn) {
                mappedColumns.add(targetColumn)
            }
        }

        // Sync local columns state: add new columns and remove unmapped ones
        if (revisionId) {
            const existingColumns = get(currentColumnsAtom)
            const existingColumnKeys = new Set(existingColumns.map((c) => c.key))
            const currentLocalCols = get(localColumnsAtomFamily(revisionId))

            // Filter out columns that are no longer mapped (keep only mapped columns)
            // Also add any new columns that don't exist yet
            const updatedLocalCols: {key: string; name: string}[] = []

            // Keep existing local columns that are still mapped
            for (const col of currentLocalCols) {
                if (mappedColumns.has(col.key)) {
                    updatedLocalCols.push(col)
                }
            }

            // Add new columns that don't exist in either existing or local columns
            for (const columnKey of mappedColumns) {
                const alreadyInLocal = updatedLocalCols.some((c) => c.key === columnKey)
                if (!existingColumnKeys.has(columnKey) && !alreadyInLocal) {
                    updatedLocalCols.push({key: columnKey, name: columnKey})
                    set(addPendingAddedColumnAtom, columnKey)
                }
            }

            // Update local columns if changed
            const hasChanged =
                updatedLocalCols.length !== currentLocalCols.length ||
                !updatedLocalCols.every((col, i) => currentLocalCols[i]?.key === col.key)

            if (hasChanged) {
                set(localColumnsAtomFamily(revisionId), updatedLocalCols)

                // Also sync localColumnsAtom (used by save flow) to only include mapped columns
                // This ensures the save flow only exports columns that are currently mapped
                const syncedLocalColumns = Array.from(mappedColumns).map((col) => ({
                    column: col,
                    isNew: !existingColumnKeys.has(col),
                }))
                set(localColumnsAtom, syncedLocalColumns)
            }
        }

        // Update each local entity based on its trace data and mappings
        traceData.forEach((trace) => {
            const entityId = entityMap.get(trace.key)
            if (!entityId) {
                return
            }

            // Get current entity to find columns to remove
            const currentEntity = get(testcaseEntityAtomFamily(entityId))

            // Build updates from mappings - ONLY include mapped columns
            // This replaces the entire entity data (except system fields)
            const updates: Record<string, string | undefined> = {}

            // First, mark all non-system columns for removal by setting to undefined
            if (currentEntity) {
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
                    "__isNew",
                    "testcase_dedup_id",
                ])
                Object.keys(currentEntity).forEach((key) => {
                    if (!SYSTEM_FIELDS.has(key)) {
                        updates[key] = undefined // Mark for deletion
                    }
                })
            }

            // Then set the mapped values (this overrides the undefined for mapped columns)
            for (const mapping of mappings) {
                const targetColumn =
                    mapping.column === "create" || !mapping.column
                        ? mapping.newColumn
                        : mapping.column

                if (!targetColumn) continue

                const value = getValueAtPath(trace, mapping.data)
                // Preserve objects/arrays as-is, only convert null/undefined to empty string
                updates[targetColumn] = value === undefined || value === null ? "" : value
            }

            if (Object.keys(updates).length > 0) {
                console.log("[updateAllLocalEntitiesAtom] Updating entity", {
                    entityId,
                    traceKey: trace.key,
                    updates,
                })
                set(updateTestcaseAtom, {id: entityId, updates})
            }
        })
    },
)

// ============================================================================
// CLEAR LOCAL ENTITIES
// ============================================================================

/**
 * Write-only atom: Clear all local entities
 *
 * Called when drawer closes or revision changes.
 */
export const clearLocalEntitiesAtom = atom(null, (get, set) => {
    const entityMap = get(localEntityMapAtom)

    if (entityMap.size > 0) {
        set(deleteTestcasesAtom, Array.from(entityMap.values()))
        set(localEntityMapAtom, new Map())
    }

    // Reset the tracking atoms so entities can be created for a new revision
    set(localEntitiesCreatedForRevisionAtom, null)
    // Clear the cleanup protection flag so future cleanups work normally
    set(localEntitiesRevisionAtom, null)
})

// ============================================================================
// UNIFIED REVISION SELECTION REDUCER
// ============================================================================

/**
 * Write-only atom: Handle revision selection in one atomic operation
 *
 * This is a reducer-style action that handles the entire flow when a revision
 * is selected:
 * 1. Sets revision context
 * 2. Reads necessary state (columns, testset info)
 * 3. Creates local entities with mapped data
 *
 * This replaces the useEffect-based approach with an explicit action.
 *
 * Usage:
 *   const selectRevision = useSetAtom(selectRevisionAtom)
 *   selectRevision({ revisionId, traceData, mappings, getValueAtPath })
 */
export const selectRevisionAtom = atom(
    null,
    (
        get,
        set,
        params: {
            revisionId: string
            traceData: TestsetTraceData[]
            mappings: {data: string; column: string; newColumn?: string}[]
            getValueAtPath: (obj: any, path: string) => any
            isNewTestset?: boolean
        },
    ) => {
        const {revisionId, traceData, mappings, getValueAtPath, isNewTestset = false} = params

        // Validate inputs - allow "draft" for new testsets
        if (!revisionId) {
            return {success: false, reason: "invalid_revision"}
        }
        if (revisionId === "draft" && !isNewTestset) {
            return {success: false, reason: "invalid_revision"}
        }

        if (traceData.length === 0) {
            return {success: false, reason: "no_trace_data"}
        }

        // Check if already created for this revision
        const alreadyCreatedFor = get(localEntitiesCreatedForRevisionAtom)
        if (alreadyCreatedFor === revisionId) {
            // Update existing entities instead of recreating
            set(updateAllLocalEntitiesAtom, {traceData, mappings, getValueAtPath})
            return {success: true, action: "updated"}
        }

        // === STEP 1: Set revision context ===
        set(currentRevisionIdAtom, revisionId)
        set(drawerRevisionIdAtom, revisionId)
        set(localEntitiesCreatedForRevisionAtom, revisionId)
        // Mark this revision as having local entities - prevents cleanup from clearing them
        set(localEntitiesRevisionAtom, revisionId)

        // === STEP 2: Clear existing state ===
        const existingMap = get(localEntityMapAtom)
        if (existingMap.size > 0) {
            set(deleteTestcasesAtom, Array.from(existingMap.values()))
            set(localEntityMapAtom, new Map())
        }

        // Clear ALL new entities
        const newEntityIds = get(newEntityIdsAtom)
        if (newEntityIds.length > 0) {
            set(deleteTestcasesAtom, newEntityIds)
        }

        // Clear pending column changes
        set(clearPendingAddedColumnsAtom)
        set(clearPendingDeletedColumnsAtom)

        // === STEP 3: Read current state ===
        const existingColumns = get(currentColumnsAtom)
        // Use selectedTestsetIdAtom from drawer (set when user selects testset)
        // instead of testsetIdAtom from entity layer (derived from revision query)
        const testsetId = get(selectedTestsetIdAtom) || ""

        // === STEP 4: Build mapped columns ===
        const mappedColumnKeys = new Set<string>()
        for (const mapping of mappings) {
            const targetColumn =
                mapping.column === "create" || !mapping.column ? mapping.newColumn : mapping.column
            if (targetColumn) {
                mappedColumnKeys.add(targetColumn)
            }
        }

        // Hide unmapped columns from server data
        for (const col of existingColumns) {
            if (!mappedColumnKeys.has(col.key)) {
                set(addPendingDeletedColumnAtom, col.key)
            }
        }

        // === STEP 4b: For new testsets, add columns to local columns ===
        if (isNewTestset) {
            const existingColumnKeys = new Set(existingColumns.map((c) => c.key))
            const newColumns: {key: string; name: string}[] = []

            for (const columnKey of mappedColumnKeys) {
                if (!existingColumnKeys.has(columnKey)) {
                    newColumns.push({key: columnKey, name: columnKey})
                    // Track as pending added column
                    set(addPendingAddedColumnAtom, columnKey)
                }
            }

            // Add to local columns for this revision
            if (newColumns.length > 0) {
                const currentLocalCols = get(localColumnsAtomFamily(revisionId))
                set(localColumnsAtomFamily(revisionId), [...currentLocalCols, ...newColumns])
            }

            // Also sync localColumnsAtom (used by save flow) to include all mapped columns
            const syncedLocalColumns = Array.from(mappedColumnKeys).map((col) => ({
                column: col,
                isNew: !existingColumnKeys.has(col),
            }))
            set(localColumnsAtom, syncedLocalColumns)
        }

        // === STEP 5: Create local entities ===
        const newMap = new Map<string, string>()

        traceData.forEach((trace, index) => {
            const entityId = `local-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 7)}`

            // Build data from mappings
            const mappedData: Record<string, string> = {}
            for (const mapping of mappings) {
                const targetColumn =
                    mapping.column === "create" || !mapping.column
                        ? mapping.newColumn
                        : mapping.column

                if (!targetColumn) continue

                const value = getValueAtPath(trace, mapping.data)
                // Preserve objects/arrays as-is, only convert null/undefined to empty string
                mappedData[targetColumn] = value === undefined || value === null ? "" : value
            }

            // Create entity with mapped data
            const flattenedRow: FlattenedTestcase = {
                id: entityId,
                testset_id: testsetId,
                ...mappedData,
            }

            // Register as new entity
            set(addNewEntityIdAtom, entityId)
            set(testcaseDraftAtomFamily(entityId), flattenedRow)

            // Track mapping
            newMap.set(trace.key, entityId)
        })

        set(localEntityMapAtom, newMap)

        return {success: true, action: "created", entityCount: newMap.size}
    },
)
