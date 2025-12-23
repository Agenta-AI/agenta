import {atom} from "jotai"

import {
    addColumnAtom,
    addPendingDeletedColumnAtom,
    clearPendingAddedColumnsAtom,
    clearPendingDeletedColumnsAtom,
    currentColumnsAtom,
} from "@/oss/state/entities/testcase/columnState"
import {deleteTestcasesAtom} from "@/oss/state/entities/testcase/mutations"
import {testsetIdAtom} from "@/oss/state/entities/testcase/queries"
import type {FlattenedTestcase} from "@/oss/state/entities/testcase/schema"
import {
    addNewEntityIdAtom,
    newEntityIdsAtom,
    testcaseDraftAtomFamily,
    updateTestcaseAtom,
} from "@/oss/state/entities/testcase/testcaseEntity"
import {currentRevisionIdAtom} from "@/oss/state/entities/testset"

import type {TestsetTraceData} from "../assets/types"

import {selectedRevisionIdAtom as drawerRevisionIdAtom} from "./drawerState"

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
        }: {
            traceData: TestsetTraceData[]
            mappings: {data: string; column: string; newColumn?: string}[]
            getValueAtPath: (obj: any, path: string) => any
        },
    ) => {
        // Set revision context first
        const revisionId = get(drawerRevisionIdAtom)
        const alreadyCreatedFor = get(localEntitiesCreatedForRevisionAtom)

        console.log("🆕 [LocalEntities] createLocalEntitiesAtom called", {
            revisionId,
            traceDataLength: traceData.length,
            alreadyCreatedFor,
            mappingsLength: mappings.length,
        })

        if (!revisionId || revisionId === "draft") {
            console.log("⚠️ [LocalEntities] No valid revision selected, skipping creation")
            return
        }

        // Prevent re-creation for the same revision (avoids infinite loops)
        if (alreadyCreatedFor === revisionId) {
            console.log("⚠️ [LocalEntities] Already created for this revision, skipping")
            return
        }

        set(currentRevisionIdAtom, revisionId)
        set(localEntitiesCreatedForRevisionAtom, revisionId)

        // Clear any existing local entities first
        const existingMap = get(localEntityMapAtom)
        if (existingMap.size > 0) {
            console.log(
                "🧹 [LocalEntities] Clearing existing entities:",
                existingMap.size,
                Array.from(existingMap.values()),
            )
            set(deleteTestcasesAtom, Array.from(existingMap.values()))
            set(localEntityMapAtom, new Map())
        }

        // Clear ALL new entities (both local- and new- prefixed)
        // This handles stale local entities AND entities created by initializeEmptyRevisionAtom
        const newEntityIds = get(newEntityIdsAtom)
        if (newEntityIds.length > 0) {
            console.log("🧹 [LocalEntities] Clearing all new entity IDs:", newEntityIds)
            set(deleteTestcasesAtom, newEntityIds)
        }

        // Clear pending column changes first
        set(clearPendingAddedColumnsAtom)
        set(clearPendingDeletedColumnsAtom)
        console.log("🧹 [LocalEntities] Cleared pending column changes")

        // Get current columns from server data BEFORE we modify anything
        const existingColumns = get(currentColumnsAtom)
        const testsetId = get(testsetIdAtom) || ""

        console.log(
            "📊 [LocalEntities] Existing columns from server:",
            existingColumns.map((c) => c.key),
        )
        console.log("📊 [LocalEntities] Testset ID:", testsetId)

        // Build set of mapped column keys
        const mappedColumnKeys = new Set<string>()
        for (const mapping of mappings) {
            const targetColumn =
                mapping.column === "create" || !mapping.column ? mapping.newColumn : mapping.column

            if (targetColumn) {
                mappedColumnKeys.add(targetColumn)
                console.log(`➕ [LocalEntities] Adding mapped column: ${targetColumn}`)
                set(addColumnAtom, targetColumn)
            }
        }

        console.log("📊 [LocalEntities] Mapped columns:", Array.from(mappedColumnKeys))

        // Hide columns from server data that are NOT in our mappings
        for (const col of existingColumns) {
            if (!mappedColumnKeys.has(col.key)) {
                console.log(`🙈 [LocalEntities] Hiding unmapped column: ${col.key}`)
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
                mappedData[targetColumn] =
                    value === undefined || value === null
                        ? ""
                        : typeof value === "string"
                          ? value
                          : JSON.stringify(value)
            }

            // Initialize with mapped data only (no extra columns)
            const flattenedRow: FlattenedTestcase = {
                id: entityId,
                testset_id: testsetId,
                ...mappedData,
            }

            console.log(`📝 [LocalEntities] Creating entity ${index}:`, {
                entityId,
                traceKey: trace.key,
                mappedData,
                flattenedRow,
            })

            // Register as new entity
            set(addNewEntityIdAtom, entityId)
            // Create draft with initial data INCLUDING mapped values
            set(testcaseDraftAtomFamily(entityId), flattenedRow)

            // Track mapping: trace.key -> entityId
            newMap.set(trace.key, entityId)
        })

        set(localEntityMapAtom, newMap)
        console.log(`✅ [LocalEntities] Created ${newMap.size} local entities`, {
            entityMap: Object.fromEntries(newMap),
        })
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
        const columns = get(currentColumnsAtom)

        console.log("🔄 [LocalEntities] updateAllLocalEntitiesAtom called", {
            entityMapSize: entityMap.size,
            traceDataLength: traceData.length,
            mappingsLength: mappings.length,
        })

        if (entityMap.size === 0) {
            console.log("⚠️ [LocalEntities] No local entities to update")
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

        // Update each local entity based on its trace data and mappings
        traceData.forEach((trace) => {
            const entityId = entityMap.get(trace.key)
            if (!entityId) {
                console.log(`⚠️ [LocalEntities] No entity found for trace key: ${trace.key}`)
                return
            }

            // Build updates from mappings
            // Start by clearing all data columns (except id and testset_id)
            const updates: Record<string, string> = {}

            // Clear all columns first (set to empty string)
            for (const col of columns) {
                updates[col.key] = ""
            }

            // Then set the mapped values
            for (const mapping of mappings) {
                const targetColumn =
                    mapping.column === "create" || !mapping.column
                        ? mapping.newColumn
                        : mapping.column

                if (!targetColumn) continue

                const value = getValueAtPath(trace, mapping.data)
                updates[targetColumn] =
                    value === undefined || value === null
                        ? ""
                        : typeof value === "string"
                          ? value
                          : JSON.stringify(value)
            }

            console.log(`📝 [LocalEntities] Updating entity ${entityId}:`, {
                traceKey: trace.key,
                updates,
            })

            if (Object.keys(updates).length > 0) {
                set(updateTestcaseAtom, {id: entityId, updates})
            }
        })

        console.log(`✅ [LocalEntities] Updated ${entityMap.size} local entities`)
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
        console.log("🧹 [LocalEntities] Cleared all local entities")
    }

    // Reset the tracking atom so entities can be created for a new revision
    set(localEntitiesCreatedForRevisionAtom, null)
})
