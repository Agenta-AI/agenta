/**
 * Loadable Controller
 *
 * Manages loadable entities (data sources like testsets) - rows (testcases), columns,
 * and execution state. Loadables can be connected to testset revisions or used locally.
 *
 * ## Architecture
 *
 * The loadable system has two layers:
 * - **store.ts**: Pure state atoms (no entity dependencies)
 * - **controller.ts**: Bridges entity APIs to loadable state
 *
 * When connected to a testset, the controller:
 * - Routes row mutations through testcaseMolecule API
 * - Syncs testcase data to loadable rows
 * - Delegates dirty detection to testcaseMolecule
 *
 * ## Usage
 *
 * ```typescript
 * import { loadableBridge } from '@agenta/entities/loadable'
 *
 * // Selectors (top-level for common operations)
 * const rows = useAtomValue(loadableBridge.rows(loadableId))
 * const activeRow = useAtomValue(loadableBridge.activeRow(loadableId))
 *
 * // Actions
 * const addRow = useSetAtom(loadableBridge.actions.addRow)
 * addRow(loadableId, { prompt: 'Hello' })
 *
 * const connectToSource = useSetAtom(loadableBridge.actions.connectToSource)
 * connectToSource(loadableId, revisionId, 'TestsetName v1')
 * ```
 */

import {projectIdAtom} from "@agenta/shared/state"
import {atom} from "jotai"
import {getDefaultStore} from "jotai/vanilla"
import {atomFamily} from "jotai-family"
import {queryClientAtom} from "jotai-tanstack-query"

import {appRevisionMolecule} from "../appRevision"
import {loadableColumnsFromRunnableAtomFamily} from "../runnable/bridge"
import type {Testcase} from "../testcase/core"
import {testcaseMolecule} from "../testcase/state/molecule"
import {
    setTestcaseIdsAtom,
    resetTestcaseIdsAtom,
    clearNewEntityIdsAtom,
    currentRevisionIdAtom,
    setCurrentRevisionIdAtom,
} from "../testcase/state/store"
import {pendingColumnOpsAtomFamily} from "../testset/state"
import {saveNewTestsetAtom, saveTestsetAtom} from "../testset/state/mutations"
import {revisionMolecule} from "../testset/state/revisionMolecule"
import {
    traceEntityAtomFamily,
    extractAgData,
    collectKeyPaths,
    filterDataPaths,
    getValueAtPath as getTraceValueAtPath,
    type TraceSpan,
    type TracesApiResponse,
} from "../trace"

import {
    loadableStateAtomFamily,
    loadableColumnsAtomFamily,
    loadableModeAtomFamily,
    loadableExecutionResultsAtomFamily,
    loadableDataAtomFamily,
    loadableConnectedSourceAtomFamily,
    loadableLinkedRunnableAtomFamily,
    loadableOutputMappingsAtomFamily,
} from "./store"
import type {
    TestsetRow,
    TestsetColumn,
    RunnableType,
    RowExecutionResult,
    OutputMapping,
} from "./types"
import {extractPaths, createOutputMappingId} from "./utils"

// ============================================================================
// CONSTANTS
// ============================================================================

/**
 * System fields to exclude from column comparisons and row data
 * These are entity metadata fields, not actual testcase data
 */
const SYSTEM_FIELDS = new Set([
    "id",
    "flags",
    "tags",
    "meta",
    "created_at",
    "updated_at",
    "deleted_at",
    "created_by_id",
    "updated_by_id",
    "deleted_by_id",
    "testset_id",
    "set_id",
    "testset_variant_id",
    "revision_id",
    "testcase_dedup_id",
])

// ============================================================================
// TESTCASE BRIDGE ATOMS
// These atoms bridge testcaseMolecule data to loadable rows when connected
// ============================================================================

/**
 * Derived rows atom that reads from testcaseMolecule when connected.
 * This is the "bridge" that syncs testcase data to the loadable format.
 *
 * Also ensures row data includes all expected columns (from linked runnable),
 * filling in empty strings for missing keys. This ensures:
 * - PROVIDED columns show all expected variables
 * - New variables appear immediately in row data
 *
 * For both local and connected modes, automatically merges output mapping
 * values from execution results into row data. This keeps data in sync
 * reactively without manual sync calls.
 */
const connectedRowsAtomFamily = atomFamily((loadableId: string) =>
    atom((get) => {
        const state = get(loadableStateAtomFamily(loadableId))

        // Get expected columns from linked runnable
        const expectedColumns = get(loadableColumnsFromRunnableAtomFamily(loadableId))
        const expectedKeys = new Set(expectedColumns.map((c) => c.key))

        // Helper to get derived output values for a row from execution results + mappings
        const getDerivedOutputValues = (rowId: string): Record<string, unknown> | null => {
            const executionResult = state.executionResults[rowId]
            if (!executionResult) return null

            const mappings = state.outputMappings ?? []
            if (mappings.length === 0) return null

            // Try to get trace data first
            let dataSource: Record<string, unknown> | null = null

            if (executionResult.traceId) {
                const traceQuery = get(traceEntityAtomFamily(executionResult.traceId))
                if (traceQuery.data) {
                    const rootSpan = getRootSpanFromTraceResponse(traceQuery.data)
                    if (rootSpan) {
                        const agData = extractAgData(rootSpan)
                        if (agData && Object.keys(agData).length > 0) {
                            // Wrap in { data: ... } to match path format (data.inputs.*, data.outputs.*)
                            dataSource = {data: agData}
                        }
                    }
                }
            }

            // Fallback to raw output if no trace data available
            if (
                !dataSource &&
                executionResult.output &&
                typeof executionResult.output === "object"
            ) {
                dataSource = executionResult.output as Record<string, unknown>
            }

            if (!dataSource) return null

            const outputValues: Record<string, unknown> = {}

            for (const mapping of mappings) {
                if (!mapping.outputPath || !mapping.targetColumn) continue
                const value = getTraceValueAtPath(dataSource, mapping.outputPath)
                if (value !== undefined) {
                    outputValues[mapping.targetColumn] = value
                }
            }

            return Object.keys(outputValues).length > 0 ? outputValues : null
        }

        // Always derive from testcaseMolecule - unified entity system for local and connected
        const allDisplayRowIds = get(testcaseMolecule.atoms.displayRowIds)

        // Filter out hidden testcase IDs (UI-only filter, doesn't affect testset data)
        const hiddenIds = state.hiddenTestcaseIds
        const displayRowIds = allDisplayRowIds.filter((id) => !hiddenIds.has(id))

        // Get original server keys from first row to filter out stale draft columns
        // This handles the case where a variable is added, used, then removed
        // Note: Testcase uses nested format - data fields are in testcase.data
        let serverKeys: Set<string> | null = null
        if (displayRowIds.length > 0) {
            const firstRowServerData = get(testcaseMolecule.selectors.serverData(displayRowIds[0]))
            if (firstRowServerData?.data) {
                serverKeys = new Set(
                    Object.keys(firstRowServerData.data).filter((key) => !SYSTEM_FIELDS.has(key)),
                )
            }
        }

        return displayRowIds.map((id) => {
            const entity = get(testcaseMolecule.data(id))
            if (!entity) {
                // Return row with all expected columns as empty
                const emptyData: Record<string, unknown> = {}
                for (const key of expectedKeys) {
                    emptyData[key] = ""
                }
                return {id, data: emptyData} as TestsetRow
            }

            // Convert testcase entity to TestsetRow format
            // For local/new entities: include ALL data columns (they were imported with full data)
            // For server entities: only include columns that are expected OR in original server data
            // This filters out stale draft columns from removed variables while preserving imported data
            // Note: Testcase uses nested format - data fields are in entity.data
            const isLocalEntity = id.startsWith("new-") || id.startsWith("local-")
            let data: Record<string, unknown> = {}
            const entityData = entity.data ?? {}
            for (const [key, value] of Object.entries(entityData)) {
                // Skip system fields (entity metadata, not actual testcase data)
                if (SYSTEM_FIELDS.has(key)) continue

                if (isLocalEntity) {
                    // Local entities: include all data columns (preserve imported data)
                    data[key] = value
                } else {
                    // Server entities: include if expected by runnable OR in original server data
                    const isExpected = expectedKeys.has(key)
                    const isOriginal = serverKeys?.has(key) ?? false
                    if (isExpected || isOriginal) {
                        data[key] = value
                    }
                }
            }

            // Fill in missing expected columns with empty strings
            for (const key of expectedKeys) {
                if (!(key in data)) {
                    data[key] = ""
                }
            }

            // Merge in derived output values from mappings (reactive)
            // Skip if output mapping is disabled for this row
            if (!state.disabledOutputMappingRowIds.has(id)) {
                const derivedValues = getDerivedOutputValues(id)
                if (derivedValues) {
                    data = {...data, ...derivedValues}
                }
            }

            return {id, data} as TestsetRow
        })
    }),
)

/**
 * Display row IDs for a loadable - filters out hidden testcase IDs.
 * This is the source of truth for which testcases are currently displayed in the UI.
 */
const displayRowIdsAtomFamily = atomFamily((loadableId: string) =>
    atom((get) => {
        const state = get(loadableStateAtomFamily(loadableId))
        const allDisplayRowIds = get(testcaseMolecule.atoms.displayRowIds)

        // Filter out hidden testcase IDs (UI-only filter, doesn't affect testset data)
        const hiddenIds = state.hiddenTestcaseIds
        return allDisplayRowIds.filter((id) => !hiddenIds.has(id))
    }),
)

/**
 * Total row count for a loadable (including hidden testcases).
 * Used to display "displayed / total" in the UI when some testcases are hidden.
 */
const totalRowCountAtomFamily = atomFamily((_loadableId: string) =>
    atom((get) => {
        const allDisplayRowIds = get(testcaseMolecule.atoms.displayRowIds)
        return allDisplayRowIds.length
    }),
)

/**
 * All rows for a loadable INCLUDING hidden ones.
 * Used by Edit Testcase Selection modal to show all testcases for re-selection.
 *
 * This is similar to connectedRowsAtomFamily but doesn't filter out hidden testcases.
 */
const allRowsIncludingHiddenAtomFamily = atomFamily((loadableId: string) =>
    atom((get) => {
        const _state = get(loadableStateAtomFamily(loadableId))

        // Get expected columns from linked runnable
        const expectedColumns = get(loadableColumnsFromRunnableAtomFamily(loadableId))
        const expectedKeys = new Set(expectedColumns.map((c) => c.key))

        // Get ALL display row IDs (not filtered by hidden)
        const allDisplayRowIds = get(testcaseMolecule.atoms.displayRowIds)

        return allDisplayRowIds.map((id) => {
            const entity = get(testcaseMolecule.data(id))
            if (!entity) {
                // Return row with all expected columns as empty
                const emptyData: Record<string, unknown> = {}
                for (const key of expectedKeys) {
                    emptyData[key] = ""
                }
                return {id, data: emptyData} as TestsetRow
            }

            // Convert testcase entity to TestsetRow format
            // Note: Testcase uses nested format - data fields are in entity.data
            const isLocalEntity = id.startsWith("new-") || id.startsWith("local-")
            const data: Record<string, unknown> = {}
            const entityData = entity.data ?? {}
            for (const [key, value] of Object.entries(entityData)) {
                if (SYSTEM_FIELDS.has(key)) continue
                if (isLocalEntity || expectedKeys.has(key)) {
                    data[key] = value
                }
            }

            // Fill in missing expected columns with empty strings
            for (const key of expectedKeys) {
                if (!(key in data)) {
                    data[key] = ""
                }
            }

            return {id, data} as TestsetRow
        })
    }),
)

/**
 * Dirty detection that uses testcaseMolecule when connected.
 *
 * Returns true if:
 * - There are changes to RELEVANT columns (expected by runnable OR in server data)
 * - OR expected columns from runnable don't exist in original row data (new variables added)
 * - OR there are applied output mapping values that differ from server data
 *
 * This is reactive - when a variable is added then removed, changes to that column
 * no longer count as "local changes" since the column is no longer relevant.
 */
const connectedHasLocalChangesAtomFamily = atomFamily((loadableId: string) =>
    atom((get) => {
        const state = get(loadableStateAtomFamily(loadableId))

        // Not connected - no "local changes" concept
        if (!state.connectedSourceId) {
            return false
        }

        // Check if there are any new column keys (new variables added)
        const newKeys = get(newColumnKeysAtomFamily(loadableId))
        if (newKeys.length > 0) {
            return true
        }

        // Get expected columns from runnable
        const expectedColumns = get(loadableColumnsFromRunnableAtomFamily(loadableId))
        const expectedKeys = new Set(expectedColumns.map((c) => c.key))

        // Get server keys from first row
        const displayRowIds = get(testcaseMolecule.atoms.displayRowIds)
        if (displayRowIds.length === 0) return false

        const firstRowServerData = get(testcaseMolecule.selectors.serverData(displayRowIds[0]))
        const serverKeys = firstRowServerData
            ? new Set(
                  Object.keys(firstRowServerData).filter(
                      (key) => key !== "id" && key !== "flags" && key !== "tags" && key !== "meta",
                  ),
              )
            : new Set<string>()

        // Relevant keys = expected by runnable OR in server data
        const relevantKeys = new Set([...expectedKeys, ...serverKeys])

        // Check if any row has changes to RELEVANT columns only
        for (const id of displayRowIds) {
            const serverData = get(testcaseMolecule.selectors.serverData(id))
            const mergedData = get(testcaseMolecule.data(id))

            if (!serverData || !mergedData) continue

            // Compare only relevant columns
            for (const key of relevantKeys) {
                const serverValue = serverData[key as keyof typeof serverData]
                const mergedValue = mergedData[key as keyof typeof mergedData]

                // If values differ, there are local changes
                if (serverValue !== mergedValue) {
                    return true
                }
            }
        }

        // Also check for applied output mapping values that differ from server data.
        // This handles the case where output mappings have been applied (via the Apply button)
        // but the draft comparison above didn't catch the change (e.g., due to trace data
        // timing or value normalization issues).
        const mappings = state.outputMappings ?? []
        if (mappings.length > 0) {
            for (const id of displayRowIds) {
                // Skip if output mapping is disabled for this row
                if (state.disabledOutputMappingRowIds.has(id)) continue

                const serverData = get(testcaseMolecule.selectors.serverData(id))
                if (!serverData) continue

                // Get derived output values for this row
                const derivedValues = get(derivedOutputValuesAtomFamily({loadableId, rowId: id}))
                if (!derivedValues) continue

                // Check if any derived output value differs from server data
                for (const [key, derivedValue] of Object.entries(derivedValues)) {
                    // Only check relevant columns (expected by runnable OR in server data)
                    if (!relevantKeys.has(key)) continue

                    const serverValue = serverData[key as keyof typeof serverData]

                    // Compare values - if they differ, there are local changes to commit
                    if (serverValue !== derivedValue) {
                        return true
                    }
                }
            }
        }

        return false
    }),
)

/**
 * Returns the list of column keys that are new (added from runnable but not in original testcase data).
 * Used to indicate "(new)" in the UI for provided columns.
 *
 * IMPORTANT: Uses serverData (not merged data) to compare against the ORIGINAL server data.
 * This ensures new columns are still detected even after the user interacts with the form
 * (which updates drafts to include new column values).
 */
const newColumnKeysAtomFamily = atomFamily((loadableId: string) =>
    atom<string[]>((get) => {
        const state = get(loadableStateAtomFamily(loadableId))

        // Not connected - no new columns concept
        if (!state.connectedSourceId) {
            return []
        }

        // Get expected columns from runnable
        const expectedColumns = get(loadableColumnsFromRunnableAtomFamily(loadableId))
        const expectedKeys = new Set(expectedColumns.map((c) => c.key))

        const displayRowIds = get(testcaseMolecule.atoms.displayRowIds)
        if (displayRowIds.length === 0) return []

        // Check first row to determine original keys - use SERVER data, not merged data
        // This ensures new columns are still detected even after drafts are created
        const firstRowServerData = get(testcaseMolecule.selectors.serverData(displayRowIds[0]))
        if (!firstRowServerData) return []

        // Get keys from original SERVER entity data (excluding system fields)
        const originalKeys = new Set(
            Object.keys(firstRowServerData).filter(
                (key) => key !== "id" && key !== "flags" && key !== "tags" && key !== "meta",
            ),
        )

        // Return keys that are expected but not in original data
        const newKeys: string[] = []
        for (const key of expectedKeys) {
            if (!originalKeys.has(key)) {
                newKeys.push(key)
            }
        }

        return newKeys
    }),
)

// ============================================================================
// DERIVED COLUMN CHANGES (for commit context)
// ============================================================================

/**
 * Reactively derives column changes by comparing:
 * - Expected columns from runnable (via appRevisionMolecule.inputPorts)
 * - Server columns from testcase data
 *
 * This is used by the adapter layer to combine with core testset changesSummary.
 * No manual sync needed - automatically updates when config changes.
 *
 * Returns:
 * - added: Column keys expected by runnable but not in original server data
 * - removed: Always empty (removal only happens via manual ops)
 *
 * @example
 * ```typescript
 * const changes = useAtomValue(derivedColumnChangesAtomFamily(loadableId))
 * // Returns: { added: ['new_var'], removed: [] }
 * ```
 */
export const derivedColumnChangesAtomFamily = atomFamily((loadableId: string) =>
    atom<{added: string[]; removed: string[]}>((get) => {
        const state = get(loadableStateAtomFamily(loadableId))
        const {linkedRunnableType, linkedRunnableId, connectedSourceId} = state

        // Not connected - no changes to report
        if (!connectedSourceId) {
            return {added: [], removed: []}
        }

        // Get expected columns from runnable (if linked)
        let expectedKeys = new Set<string>()
        if (linkedRunnableType === "appRevision" && linkedRunnableId) {
            // Use the inputPorts from appRevisionMolecule - single source of truth
            const inputPorts = get(appRevisionMolecule.selectors.inputPorts(linkedRunnableId))
            expectedKeys = new Set(inputPorts.map((p) => p.key))
        } else {
            // Fallback to loadableColumnsFromRunnableAtomFamily for other runnable types
            const expectedColumns = get(loadableColumnsFromRunnableAtomFamily(loadableId))
            expectedKeys = new Set(expectedColumns.map((c) => c.key))
        }

        // Get server columns from testcase data
        const displayRowIds = get(testcaseMolecule.atoms.displayRowIds)
        if (displayRowIds.length === 0) {
            // No testcases - all expected columns are "new"
            return {added: [...expectedKeys], removed: []}
        }

        const serverData = get(testcaseMolecule.selectors.serverData(displayRowIds[0]))
        const serverKeys = serverData
            ? new Set(Object.keys(serverData).filter((k) => !SYSTEM_FIELDS.has(k)))
            : new Set<string>()

        // Derive changes: expected keys not in server data = added
        const added = [...expectedKeys].filter((k) => !serverKeys.has(k))

        // Removal only happens via manual ops (pendingColumnOpsAtomFamily)
        const removed: string[] = []

        return {added, removed}
    }),
)

// ============================================================================
// ROW ACTIONS
// ============================================================================

/**
 * Add a row to the loadable
 * Always routes through testcase molecule for unified entity management
 */
const addRowAtom = atom(null, (get, set, loadableId: string, data?: Record<string, unknown>) => {
    const state = get(loadableStateAtomFamily(loadableId))

    // Always route through testcase molecule - local or connected
    // Pass data wrapped in {data: ...} to match Testcase nested format
    const result = set(testcaseMolecule.actions.add, data ? {data} : undefined)
    if (result?.id) {
        // Update active row
        set(loadableStateAtomFamily(loadableId), {
            ...state,
            activeRowId: result.id,
        })
    }
    return result?.id ?? null
})

/**
 * Update a row's data
 * Always routes through testcase molecule for unified entity management
 */
const updateRowAtom = atom(
    null,
    (_get, set, _loadableId: string, rowId: string, data: Record<string, unknown>) => {
        // Always route through testcase molecule - local or connected
        // Pass data wrapped in {data: ...} to match Testcase nested format
        set(testcaseMolecule.actions.update, rowId, {data})
    },
)

/**
 * Remove a row from the execution UI
 *
 * Hides the testcase from the execution UI without deleting it.
 * Works for both local and server entities, allowing recovery via "Edit Testcase Selection".
 *
 * This ensures that removing a testcase from the execution view doesn't permanently
 * delete it. The testcase can be re-added via the Edit Testcase Selection modal.
 */
const removeRowAtom = atom(null, (get, set, loadableId: string, rowId: string) => {
    const state = get(loadableStateAtomFamily(loadableId))

    // Hide the row from execution UI (both local and server entities)
    // This allows recovery via "Edit Testcase Selection" for all testcases
    const newHiddenIds = new Set(state.hiddenTestcaseIds)
    newHiddenIds.add(rowId)

    // Update active row if needed
    const allDisplayRowIds = get(testcaseMolecule.atoms.displayRowIds)
    const remaining = allDisplayRowIds.filter((id) => id !== rowId && !newHiddenIds.has(id))
    const newActiveRowId = state.activeRowId === rowId ? (remaining[0] ?? null) : state.activeRowId

    set(loadableStateAtomFamily(loadableId), {
        ...state,
        hiddenTestcaseIds: newHiddenIds,
        activeRowId: newActiveRowId,
    })
})

/**
 * Set the active row
 */
const setActiveRowAtom = atom(null, (get, set, loadableId: string, rowId: string | null) => {
    const state = get(loadableStateAtomFamily(loadableId))
    set(loadableStateAtomFamily(loadableId), {
        ...state,
        activeRowId: rowId,
    })
})

/**
 * Import testcases as new local rows (without changing connection state)
 * Used when user wants to add testcases from a testset without replacing existing data
 *
 * If a testcase was previously hidden (removed from UI but not deleted), importing it
 * will unhide it instead of creating a duplicate.
 */
const importRowsAtom = atom(
    null,
    (get, set, loadableId: string, testcases: Record<string, unknown>[]) => {
        const state = get(loadableStateAtomFamily(loadableId))
        const addedIds: string[] = []
        const unhiddenIds: string[] = []

        // Track IDs to unhide
        const newHiddenIds = new Set(state.hiddenTestcaseIds)

        // Get existing testcase IDs to check for duplicates
        const existingIds = new Set(get(testcaseMolecule.atoms.displayRowIds))

        // Add each testcase as a new local entity (or unhide if already exists)
        for (const tc of testcases) {
            const tcId = tc.id as string | undefined

            // Check if this testcase is currently hidden - if so, unhide it instead of creating duplicate
            if (tcId && state.hiddenTestcaseIds.has(tcId)) {
                newHiddenIds.delete(tcId)
                unhiddenIds.push(tcId)
                continue
            }

            // Skip if testcase already exists and is not hidden (avoid duplicates)
            if (tcId && existingIds.has(tcId) && !state.hiddenTestcaseIds.has(tcId)) {
                continue
            }

            // The incoming testcases may have data at top level or nested in .data
            // Extract data fields (skip system fields) and wrap in {data: ...} for molecule
            const dataFields: Record<string, unknown> = {}

            // Check if data is nested (new format) or flat (legacy)
            const sourceData =
                tc.data && typeof tc.data === "object" && !Array.isArray(tc.data)
                    ? (tc.data as Record<string, unknown>)
                    : tc

            for (const [key, value] of Object.entries(sourceData)) {
                // Skip system fields - only keep actual data columns
                if (!SYSTEM_FIELDS.has(key)) {
                    dataFields[key] = value
                }
            }

            // Pass data wrapped in {data: ...} to match Testcase nested format
            const result = set(testcaseMolecule.actions.add, {data: dataFields})

            if (result?.id) {
                addedIds.push(result.id)
            }
        }

        // Update hidden IDs if any were unhidden
        const allResultIds = [...addedIds, ...unhiddenIds]
        if (unhiddenIds.length > 0 || (!state.activeRowId && allResultIds.length > 0)) {
            set(loadableStateAtomFamily(loadableId), {
                ...state,
                hiddenTestcaseIds: newHiddenIds,
                activeRowId: state.activeRowId ?? allResultIds[0] ?? null,
            })
        } else if (!state.activeRowId && addedIds.length > 0) {
            set(loadableStateAtomFamily(loadableId), {
                ...state,
                activeRowId: addedIds[0],
            })
        }

        return allResultIds
    },
)

/**
 * Set all rows - creates testcase entities from row data
 */
const setRowsAtom = atom(null, (get, set, loadableId: string, rows: TestsetRow[]) => {
    const state = get(loadableStateAtomFamily(loadableId))

    // Clear existing testcase entities first
    const existingIds = get(testcaseMolecule.atoms.displayRowIds)
    for (const id of existingIds) {
        set(testcaseMolecule.actions.delete, id)
    }

    // Create new testcase entities from rows
    // Pass data wrapped in {data: ...} to match Testcase nested format
    for (const row of rows) {
        set(testcaseMolecule.actions.add, {data: row.data})
    }

    // Update active row
    const newDisplayRowIds = get(testcaseMolecule.atoms.displayRowIds)
    set(loadableStateAtomFamily(loadableId), {
        ...state,
        activeRowId: newDisplayRowIds.length > 0 ? newDisplayRowIds[0] : null,
    })
})

/**
 * Clear all rows - deletes all testcase entities
 */
const clearRowsAtom = atom(null, (get, set, loadableId: string) => {
    const state = get(loadableStateAtomFamily(loadableId))

    // Delete all testcase entities
    const existingIds = get(testcaseMolecule.atoms.displayRowIds)
    for (const id of existingIds) {
        set(testcaseMolecule.actions.delete, id)
    }

    set(loadableStateAtomFamily(loadableId), {
        ...state,
        activeRowId: null,
        executionResults: {},
    })
})

// ============================================================================
// COLUMN ACTIONS
// ============================================================================

/**
 * Set columns
 */
const setColumnsAtom = atom(null, (get, set, loadableId: string, columns: TestsetColumn[]) => {
    const state = get(loadableStateAtomFamily(loadableId))
    set(loadableStateAtomFamily(loadableId), {
        ...state,
        columns,
    })
})

/**
 * Initialize with columns
 * Sets up columns and creates an initial empty row if needed
 */
const initializeWithColumnsAtom = atom(
    null,
    (get, set, loadableId: string, columns: TestsetColumn[]) => {
        const state = get(loadableStateAtomFamily(loadableId))

        // Build initial empty data from columns
        const emptyData: Record<string, unknown> = {}
        columns.forEach((col) => {
            emptyData[col.key] = ""
        })

        // Check if we need to create an initial row
        const displayRowIds = get(testcaseMolecule.atoms.displayRowIds)
        const shouldAddRow = displayRowIds.length === 0 && !state.connectedSourceId

        // Update columns in state
        set(loadableStateAtomFamily(loadableId), {
            ...state,
            columns,
        })

        // Add initial empty row if needed (via testcaseMolecule)
        if (shouldAddRow) {
            set(addRowAtom, loadableId, emptyData)
        }
    },
)

/**
 * Add a column
 * Updates column list and adds empty value to all testcase entities
 */
const addColumnAtom = atom(null, (get, set, loadableId: string, column: TestsetColumn) => {
    const state = get(loadableStateAtomFamily(loadableId))

    // Update columns in loadable state
    set(loadableStateAtomFamily(loadableId), {
        ...state,
        columns: [...state.columns, column],
    })

    // Add empty value to all testcase entities
    const displayRowIds = get(testcaseMolecule.atoms.displayRowIds)
    for (const rowId of displayRowIds) {
        set(testcaseMolecule.actions.update, rowId, {[column.key]: ""})
    }
})

/**
 * Remove a column
 * Updates column list - testcase entity data cleanup happens on save
 */
const removeColumnAtom = atom(null, (get, set, loadableId: string, columnKey: string) => {
    const state = get(loadableStateAtomFamily(loadableId))

    // Update columns in loadable state
    set(loadableStateAtomFamily(loadableId), {
        ...state,
        columns: state.columns.filter((c) => c.key !== columnKey),
    })

    // Note: We don't remove the key from testcase entities here
    // The column filtering happens at the view layer (connectedRowsAtomFamily)
    // and actual data cleanup happens on save via pendingColumnOps
})

// ============================================================================
// CONNECTION ACTIONS
// ============================================================================

/**
 * Connect to an external source (e.g., testset revision)
 * Uses testcaseMolecule public API for initialization.
 */
const connectToSourceAtom = atom(
    null,
    (
        get,
        set,
        loadableId: string,
        sourceId: string,
        sourceName?: string,
        testcases?: {id: string; [key: string]: unknown}[],
    ) => {
        const state = get(loadableStateAtomFamily(loadableId))
        const queryClient = get(queryClientAtom)
        const projectId = get(projectIdAtom)

        // Clear local entities before connecting to a new source
        // This ensures Replace mode fully replaces existing data
        set(clearNewEntityIdsAtom)

        // If testcases provided, populate query cache and set IDs
        // Note: Testcases are stored in nested Testcase format
        if (testcases && testcases.length > 0) {
            const ids: string[] = []
            for (const tc of testcases) {
                queryClient.setQueryData(["testcase", projectId, tc.id], tc as Testcase)
                ids.push(tc.id)
            }
            // Reset and set testcase IDs so displayRowIds picks them up
            set(resetTestcaseIdsAtom)
            set(setTestcaseIdsAtom, ids)
        }

        set(loadableStateAtomFamily(loadableId), {
            ...state,
            connectedSourceId: sourceId,
            connectedSourceName: sourceName ?? null,
            // Set source type to 'testcase' - this is the only supported type currently
            // Future: accept sourceType as parameter for trace/other sources
            connectedSourceType: "testcase",
            // Clear hidden testcase IDs when connecting to a new source
            hiddenTestcaseIds: new Set<string>(),
        })

        // Set currentRevisionIdAtom so changesSummaryAtom reads from the correct revision
        // This is needed for the commit modal to show proper diff data
        set(setCurrentRevisionIdAtom, sourceId)
    },
)

/**
 * Disconnect from source (switch to local mode)
 *
 * This clears:
 * - connectedSourceId and connectedSourceName in loadable state
 * - currentRevisionIdAtom context
 * - testcaseIdsAtom (server IDs from connected testset)
 *
 * Note: Does NOT transfer testcases from connected testset to local state.
 * After disconnect, the loadable will have empty local rows.
 */
const disconnectAtom = atom(null, (get, set, loadableId: string) => {
    const state = get(loadableStateAtomFamily(loadableId))
    set(loadableStateAtomFamily(loadableId), {
        ...state,
        connectedSourceId: null,
        connectedSourceName: null,
        connectedSourceType: null,
        activeRowId: null,
    })
    // Clear currentRevisionIdAtom since we're no longer connected
    set(setCurrentRevisionIdAtom, null)
    // Reset testcase IDs - these were populated when connecting to a source
    set(resetTestcaseIdsAtom)
})

/**
 * Update testcase selection for a connected loadable.
 * This allows editing which testcases are included after initial connection.
 *
 * Used by TestsetSelectionModal in "edit" mode to modify the selection
 * without disconnecting and reconnecting.
 *
 * This also unhides any testcases that were previously hidden but are now
 * being re-selected, and hides any testcases that are being deselected.
 */
const updateTestcaseSelectionAtom = atom(
    null,
    (get, set, loadableId: string, selectedIds: string[]) => {
        const state = get(loadableStateAtomFamily(loadableId))
        const selectedSet = new Set(selectedIds)

        // Get all testcase IDs (including hidden ones) to determine what's being deselected
        const allDisplayRowIds = get(testcaseMolecule.atoms.displayRowIds)

        // Calculate new hidden set:
        // - Remove from hidden: IDs that are now selected (unhide)
        // - Add to hidden: IDs that exist but are not selected (hide)
        const newHiddenIds = new Set<string>()
        for (const id of allDisplayRowIds) {
            if (!selectedSet.has(id)) {
                // This ID exists but is not selected - hide it
                newHiddenIds.add(id)
            }
        }

        // Update hidden testcase IDs in loadable state
        set(loadableStateAtomFamily(loadableId), {
            ...state,
            hiddenTestcaseIds: newHiddenIds,
        })

        // Only update testcaseIdsAtom for CONNECTED mode (server testcases)
        // For local testsets, the IDs are already in newEntityIdsAtom and
        // displayRowIds combines both. Calling setTestcaseIdsAtom would cause duplicates.
        if (state.connectedSourceId) {
            // Reset first, then set - setTestcaseIdsAtom appends, so we need to clear first
            set(resetTestcaseIdsAtom)
            set(setTestcaseIdsAtom, selectedIds)
        }
    },
)

/**
 * Discard local changes (revert to connected source data)
 */
const discardChangesAtom = atom(null, (get, set, loadableId: string) => {
    const state = get(loadableStateAtomFamily(loadableId))

    if (state.connectedSourceId) {
        // CONNECTED: Delegate to testcase molecule
        set(testcaseMolecule.actions.discardAll)
        return
    }

    // LOCAL: Clear local testcase entities
    const existingIds = get(testcaseMolecule.atoms.displayRowIds)
    for (const id of existingIds) {
        set(testcaseMolecule.actions.delete, id)
    }
})

/**
 * Commit local changes to create a new revision
 * Delegates to saveTestsetAtom which reads from testcaseMolecule
 *
 * Before committing, applies any pending output mappings to ensure derived
 * output values are included in the commit.
 */
const commitChangesAtom = atom(
    null,
    async (
        get,
        set,
        loadableId: string,
        message?: string,
    ): Promise<{revisionId: string; version: number}> => {
        const state = get(loadableStateAtomFamily(loadableId))
        const projectId = get(projectIdAtom)

        if (!state.connectedSourceId) {
            throw new Error("Cannot commit: not connected to a source")
        }

        if (!projectId) {
            throw new Error("No project ID available")
        }

        // Apply any pending output mappings before committing.
        // This ensures derived output values (from execution results) are included
        // in the testcase drafts and will be saved. This handles the case where
        // the user didn't explicitly click "Apply" or where trace data wasn't
        // available when Apply was clicked.
        const mappings = state.outputMappings ?? []
        if (mappings.length > 0) {
            set(applyOutputMappingsToAllAtom, loadableId)
        }

        // Get testset ID from revision
        const revisionQuery = get(revisionMolecule.query(state.connectedSourceId))
        const testsetId = revisionQuery?.data?.testset_id
        if (!testsetId) {
            throw new Error("Could not determine testset ID from revision")
        }

        // Delegate to saveTestsetAtom which reads from testcaseMolecule
        const result = await set(saveTestsetAtom, {
            projectId,
            testsetId,
            revisionId: state.connectedSourceId,
            commitMessage: message,
        })

        if (!result.success) {
            throw result.error ?? new Error("Commit failed")
        }

        return {
            revisionId: result.newRevisionId!,
            version: result.newVersion ?? 1,
        }
    },
)

// ============================================================================
// NAME MANAGEMENT
// ============================================================================

/**
 * Name selector for a loadable
 */
const loadableNameAtomFamily = atomFamily((loadableId: string) =>
    atom((get) => {
        const state = get(loadableStateAtomFamily(loadableId))
        // Return name if set, otherwise fall back to connected source name
        return state.name ?? state.connectedSourceName ?? null
    }),
)

/**
 * Set the name for a loadable (used when creating new testset)
 */
const setNameAtom = atom(null, (get, set, loadableId: string, name: string | null) => {
    const state = get(loadableStateAtomFamily(loadableId))
    set(loadableStateAtomFamily(loadableId), {
        ...state,
        name,
    })
})

// ============================================================================
// SAVE AS NEW TESTSET
// ============================================================================

/**
 * Result of save as new testset operation
 */
export interface SaveAsNewTestsetResult {
    success: boolean
    revisionId?: string
    testsetId?: string
    error?: Error
}

/**
 * Save loadable data as a new testset
 * Uses the testset entity save mutation which reads from testcaseMolecule
 */
const saveAsNewTestsetAtom = atom(
    null,
    async (
        get,
        set,
        loadableId: string,
        _commitMessage?: string,
    ): Promise<SaveAsNewTestsetResult> => {
        const state = get(loadableStateAtomFamily(loadableId))
        const projectId = get(projectIdAtom)

        if (!projectId) {
            return {success: false, error: new Error("No project ID available")}
        }

        const name = state.name
        if (!name?.trim()) {
            return {success: false, error: new Error("Testset name is required")}
        }

        // Check if there are testcase entities to save
        const newIds = get(testcaseMolecule.atoms.newIds)
        if (newIds.length === 0) {
            return {success: false, error: new Error("No testcases to save")}
        }

        try {
            // Use the testset entity save mutation - reads from testcaseMolecule
            const result = await set(saveNewTestsetAtom, {
                projectId,
                testsetName: name.trim(),
            })

            if (!result.success) {
                return {success: false, error: result.error}
            }

            return {
                success: true,
                revisionId: result.revisionId,
                testsetId: result.testsetId,
            }
        } catch (err) {
            return {
                success: false,
                error: err instanceof Error ? err : new Error(String(err)),
            }
        }
    },
)

// ============================================================================
// RUNNABLE LINKING ACTIONS
// ============================================================================

/**
 * Selector: determines if output mappings should be auto-initialized.
 *
 * Returns true when:
 * - Loadable is linked to an appRevision runnable
 * - No output mappings exist yet
 * - Schema has loaded with real output ports (not just default "output" fallback)
 *
 * This is a pure derived selector - no side effects.
 */
const shouldAutoInitOutputMappingsAtomFamily = atomFamily((loadableId: string) =>
    atom((get) => {
        const state = get(loadableStateAtomFamily(loadableId))

        // Must be linked to a runnable
        if (!state.linkedRunnableId || !state.linkedRunnableType) {
            return false
        }

        // Must not already have mappings
        if (state.outputMappings.length > 0) {
            return false
        }

        // Only auto-init for appRevision type
        if (state.linkedRunnableType !== "appRevision") {
            return false
        }

        // Check if schema has loaded with real output ports
        const schemaQuery = get(appRevisionMolecule.selectors.schemaQuery(state.linkedRunnableId))

        // Still loading - not ready yet
        if (schemaQuery.isPending) {
            return false
        }

        // Error loading schema - don't auto-init
        if (schemaQuery.isError) {
            return false
        }

        // Schema loaded - check for real output ports
        const outputPorts = get(appRevisionMolecule.selectors.outputPorts(state.linkedRunnableId))
        const hasRealOutputPorts =
            outputPorts.length > 1 || (outputPorts.length === 1 && outputPorts[0].key !== "output")

        return hasRealOutputPorts
    }),
)

/**
 * Effect atom: auto-initializes output mappings when conditions are met.
 *
 * This atom is designed to be read as part of a selector chain (e.g., in `rows` or `columns`).
 * When `shouldAutoInitOutputMappings` becomes true, it triggers the initialization
 * and returns a flag indicating it was triggered.
 *
 * The pattern: read this atom in a frequently-accessed selector to ensure
 * the effect runs reactively when conditions change.
 */
const autoInitOutputMappingsEffectAtomFamily = atomFamily((loadableId: string) =>
    atom((get) => {
        const shouldInit = get(shouldAutoInitOutputMappingsAtomFamily(loadableId))

        if (shouldInit) {
            // Use getDefaultStore to trigger the write imperatively from a read atom
            // This is safe because we're only writing when conditions are met,
            // and the conditions include checks that prevent re-triggering
            const store = getDefaultStore()
            store.set(initializeDefaultOutputMappingsAtom, loadableId)
            return true
        }

        return false
    }),
)

/**
 * Link to a runnable (columns derive from runnable's inputSchema)
 * Also creates an initial empty row if no rows exist and not connected to a testset.
 *
 * This is a synchronous action that:
 * 1. Updates the linked runnable state immediately
 * 2. Adds an initial empty row if needed
 *
 * Output mapping initialization happens reactively via `autoInitOutputMappingsEffectAtomFamily`
 * when the schema loads. This avoids polling and keeps the action synchronous.
 */
const linkToRunnableAtom = atom(
    null,
    (get, set, loadableId: string, runnableType: RunnableType, runnableId: string) => {
        const state = get(loadableStateAtomFamily(loadableId))

        // Check if we need to create an initial row
        const displayRowIds = get(testcaseMolecule.atoms.displayRowIds)
        const shouldAddRow = displayRowIds.length === 0 && !state.connectedSourceId

        // Update linked runnable immediately
        set(loadableStateAtomFamily(loadableId), {
            ...state,
            linkedRunnableType: runnableType,
            linkedRunnableId: runnableId,
        })

        // Add initial empty row if needed (via testcaseMolecule)
        if (shouldAddRow) {
            set(addRowAtom, loadableId, {})
        }

        // Output mapping initialization happens reactively via autoInitOutputMappingsEffectAtomFamily
        // when the schema loads. No polling needed.
    },
)

/**
 * Unlink from runnable
 */
const unlinkFromRunnableAtom = atom(null, (get, set, loadableId: string) => {
    const state = get(loadableStateAtomFamily(loadableId))
    set(loadableStateAtomFamily(loadableId), {
        ...state,
        linkedRunnableType: null,
        linkedRunnableId: null,
    })
})

// ============================================================================
// EXECUTION STATE ACTIONS
// ============================================================================

/**
 * Set execution result for a row
 */
const setRowExecutionResultAtom = atom(
    null,
    (get, set, loadableId: string, result: RowExecutionResult) => {
        const state = get(loadableStateAtomFamily(loadableId))
        set(loadableStateAtomFamily(loadableId), {
            ...state,
            executionResults: {
                ...state.executionResults,
                [result.rowId]: result,
            },
        })
    },
)

/**
 * Clear execution result for a row
 */
const clearRowExecutionResultAtom = atom(null, (get, set, loadableId: string, rowId: string) => {
    const state = get(loadableStateAtomFamily(loadableId))
    const {[rowId]: _removed, ...rest} = state.executionResults
    set(loadableStateAtomFamily(loadableId), {
        ...state,
        executionResults: rest,
    })
})

// ============================================================================
// OUTPUT MAPPING ATOMS
// Maps execution output paths to testcase columns
// ============================================================================

/**
 * Add an output mapping
 */
const addOutputMappingAtom = atom(
    null,
    (get, set, loadableId: string, mapping: Omit<OutputMapping, "id">) => {
        const state = get(loadableStateAtomFamily(loadableId))
        const id = createOutputMappingId()

        set(loadableStateAtomFamily(loadableId), {
            ...state,
            outputMappings: [...(state.outputMappings ?? []), {...mapping, id}],
        })

        return id
    },
)

/**
 * Remove an output mapping
 */
const removeOutputMappingAtom = atom(null, (get, set, loadableId: string, mappingId: string) => {
    const state = get(loadableStateAtomFamily(loadableId))
    set(loadableStateAtomFamily(loadableId), {
        ...state,
        outputMappings: state.outputMappings?.filter((m) => m.id !== mappingId) ?? [],
    })
})

/**
 * Update an output mapping
 */
const updateOutputMappingAtom = atom(
    null,
    (get, set, loadableId: string, mappingId: string, updates: Partial<OutputMapping>) => {
        const state = get(loadableStateAtomFamily(loadableId))
        set(loadableStateAtomFamily(loadableId), {
            ...state,
            outputMappings:
                state.outputMappings?.map((m) => (m.id === mappingId ? {...m, ...updates} : m)) ??
                [],
        })
    },
)

/**
 * Clear all output mappings
 */
const clearOutputMappingsAtom = atom(null, (get, set, loadableId: string) => {
    const state = get(loadableStateAtomFamily(loadableId))
    set(loadableStateAtomFamily(loadableId), {
        ...state,
        outputMappings: [],
    })
})

/**
 * Helper to extract the root span from a TracesApiResponse.
 * The response format is: { traces: { [traceId]: { spans: { [spanId]: TraceSpan } } } }
 * Returns the root span (one with no parent_id) or the first span.
 */
const getRootSpanFromTraceResponse = (
    traceResponse: TracesApiResponse | null,
): TraceSpan | null => {
    if (!traceResponse?.traces) return null

    // Get the first trace entry
    const traceEntries = Object.values(traceResponse.traces)
    if (traceEntries.length === 0) return null

    const traceEntry = traceEntries[0]
    if (!traceEntry?.spans) return null

    // Get all spans
    const spans = Object.values(traceEntry.spans) as TraceSpan[]
    if (spans.length === 0) return null

    // Find the root span (no parent_id) or use the first one
    return spans.find((s) => !s.parent_id) || spans[0]
}

// ============================================================================
// TRACE DATA SUMMARY - Single source of truth for trace-derived data
// ============================================================================

/**
 * Metrics extracted from trace data
 */
export interface TraceMetrics {
    durationMs?: number
    totalTokens?: number
    promptTokens?: number
    completionTokens?: number
    totalCost?: number
}

/**
 * Summary of trace data including both paths (for mapping) and metrics (for display)
 */
export interface TraceDataSummary {
    /** Whether trace data is still loading */
    isPending: boolean
    /** Available output paths for mapping (data.inputs.*, data.outputs.*, etc.) */
    paths: string[]
    /** Metrics extracted from trace (latency, tokens, cost) */
    metrics: TraceMetrics
    /** Raw root span for advanced use */
    rootSpan: TraceSpan | null
    /** Extracted ag.data object */
    agData: Record<string, unknown> | null
}

/**
 * Helper to extract numeric value from various metric locations
 */
const extractMetricValue = (
    agData: Record<string, unknown> | null,
    rootSpan: TraceSpan | null,
    ...paths: string[]
): number | undefined => {
    if (!agData && !rootSpan) return undefined

    // Try paths in order of preference
    for (const path of paths) {
        // Try from agData first
        if (agData) {
            const value = getTraceValueAtPath(agData, path)
            if (typeof value === "number" && Number.isFinite(value)) return value
            // Try extracting .total from object
            if (value && typeof value === "object") {
                const obj = value as Record<string, unknown>
                if (typeof obj.total === "number") return obj.total
            }
        }
        // Try from span attributes
        if (rootSpan?.attributes) {
            const value = getTraceValueAtPath(rootSpan.attributes, path)
            if (typeof value === "number" && Number.isFinite(value)) return value
            if (value && typeof value === "object") {
                const obj = value as Record<string, unknown>
                if (typeof obj.total === "number") return obj.total
            }
        }
    }
    return undefined
}

/**
 * Single source of truth for trace-derived data.
 * Provides both paths (for output mapping) and metrics (for result utils display).
 *
 * This atom family fetches trace data once and derives all needed information,
 * avoiding duplicate fetches between mapping and metrics display.
 */
export const traceDataSummaryAtomFamily = atomFamily((traceId: string | null) =>
    atom((get): TraceDataSummary => {
        const emptyResult: TraceDataSummary = {
            isPending: false,
            paths: [],
            metrics: {},
            rootSpan: null,
            agData: null,
        }

        if (!traceId) return emptyResult

        // Fetch trace data (cached by TanStack Query)
        const traceQuery = get(traceEntityAtomFamily(traceId))

        if (traceQuery.isPending) {
            return {...emptyResult, isPending: true}
        }

        if (!traceQuery.data) {
            return emptyResult
        }

        // Get the root span
        const rootSpan = getRootSpanFromTraceResponse(traceQuery.data)
        if (!rootSpan) {
            return emptyResult
        }

        // Extract ag.data
        const agData = extractAgData(rootSpan)

        // Extract paths for output mapping
        let paths: string[] = []
        if (agData && Object.keys(agData).length > 0) {
            const allPaths = collectKeyPaths(agData, "data")
            paths = filterDataPaths(allPaths)
        }

        // Extract metrics
        const metrics: TraceMetrics = {
            durationMs: extractMetricValue(
                agData,
                rootSpan,
                "metrics.duration.cumulative.total",
                "metrics.acc.duration.total",
                "metrics.unit.duration.total",
                "ag.metrics.duration.cumulative.total",
            ),
            totalTokens: extractMetricValue(
                agData,
                rootSpan,
                "metrics.tokens.cumulative.total",
                "metrics.acc.tokens.total",
                "metrics.unit.tokens.total",
                "ag.metrics.tokens.cumulative.total",
            ),
            promptTokens: extractMetricValue(
                agData,
                rootSpan,
                "metrics.tokens.cumulative.prompt",
                "metrics.acc.tokens.prompt",
                "ag.metrics.tokens.cumulative.prompt",
            ),
            completionTokens: extractMetricValue(
                agData,
                rootSpan,
                "metrics.tokens.cumulative.completion",
                "metrics.acc.tokens.completion",
                "ag.metrics.tokens.cumulative.completion",
            ),
            totalCost: extractMetricValue(
                agData,
                rootSpan,
                "metrics.costs.cumulative.total",
                "metrics.acc.costs.total",
                "metrics.unit.costs.total",
                "ag.metrics.costs.cumulative.total",
            ),
        }

        return {
            isPending: false,
            paths,
            metrics,
            rootSpan,
            agData,
        }
    }),
)

/**
 * Available output paths from execution results.
 * Uses traceDataSummaryAtomFamily (single source of truth) to get paths.
 *
 * Falls back to raw output extraction if no trace ID is available.
 */
const availableOutputPathsAtomFamily = atomFamily((loadableId: string) =>
    atom((get) => {
        const state = get(loadableStateAtomFamily(loadableId))
        const results = Object.values(state.executionResults)

        if (results.length === 0) {
            return []
        }

        // Find a result with a trace ID
        const resultWithTrace = results.find((r) => r?.traceId)
        if (!resultWithTrace?.traceId) {
            // Fallback: try to extract from raw output (for backwards compatibility)
            const resultWithOutput = results.find((r) => r?.output && typeof r.output === "object")
            if (!resultWithOutput?.output) {
                return []
            }
            return extractPaths(resultWithOutput.output)
        }

        // Use the unified trace data summary
        const traceSummary = get(traceDataSummaryAtomFamily(resultWithTrace.traceId))
        return traceSummary.paths
    }),
)

/**
 * Output data preview from execution results.
 * Returns the agData object for showing data values alongside paths in the UI.
 * Uses the unified trace data summary (single source of truth).
 */
const outputDataPreviewAtomFamily = atomFamily((loadableId: string) =>
    atom((get) => {
        const state = get(loadableStateAtomFamily(loadableId))
        const results = Object.values(state.executionResults)

        if (results.length === 0) {
            return null
        }

        // Find a result with a trace ID
        const resultWithTrace = results.find((r) => r?.traceId)
        if (!resultWithTrace?.traceId) {
            // Fallback: return raw output if no trace data
            const resultWithOutput = results.find((r) => r?.output && typeof r.output === "object")
            return resultWithOutput?.output as Record<string, unknown> | null
        }

        // Use the unified trace data summary
        const traceSummary = get(traceDataSummaryAtomFamily(resultWithTrace.traceId))
        return traceSummary.agData
    }),
)

/**
 * Derived: Output values for a row based on mappings.
 * Uses trace data to extract values at the mapped paths.
 * Returns { [columnKey]: value } ready to merge into testcase.
 *
 * The flow:
 * 1. Get the execution result for this row
 * 2. Fetch trace data using the result's traceId
 * 3. Extract ag.data from the root span
 * 4. For each mapping, extract the value at the specified path
 */
const derivedOutputValuesAtomFamily = atomFamily(
    ({loadableId, rowId}: {loadableId: string; rowId: string}) =>
        atom((get) => {
            const state = get(loadableStateAtomFamily(loadableId))

            const executionResult = state.executionResults[rowId]
            if (!executionResult) return null

            const mappings = state.outputMappings ?? []
            if (mappings.length === 0) return null

            // Try to get trace data first
            let dataSource: Record<string, unknown> | null = null

            if (executionResult.traceId) {
                const traceQuery = get(traceEntityAtomFamily(executionResult.traceId))
                if (traceQuery.data) {
                    const rootSpan = getRootSpanFromTraceResponse(traceQuery.data)
                    if (rootSpan) {
                        const agData = extractAgData(rootSpan)
                        if (agData && Object.keys(agData).length > 0) {
                            // Wrap in { data: ... } to match path format (data.inputs.*, data.outputs.*)
                            dataSource = {data: agData}
                        }
                    }
                }
            }

            // Fallback to raw output if no trace data available
            if (
                !dataSource &&
                executionResult.output &&
                typeof executionResult.output === "object"
            ) {
                dataSource = executionResult.output as Record<string, unknown>
            }

            if (!dataSource) return null

            const outputValues: Record<string, unknown> = {}

            for (const mapping of mappings) {
                if (!mapping.outputPath || !mapping.targetColumn) continue
                // Use trace getValueAtPath which handles JSON parsing and nested paths
                const value = getTraceValueAtPath(dataSource, mapping.outputPath)
                if (value !== undefined) {
                    outputValues[mapping.targetColumn] = value
                }
            }

            return Object.keys(outputValues).length > 0 ? outputValues : null
        }),
)

/**
 * Check if any row has execution results with output
 */
const hasExecutionResultsAtomFamily = atomFamily((loadableId: string) =>
    atom((get) => {
        const state = get(loadableStateAtomFamily(loadableId))
        return Object.values(state.executionResults).some((r) => r?.output)
    }),
)

// ============================================================================
// ROW STATE INDICATORS
// ============================================================================

/**
 * Row state indicator: whether a testcase row is "ready" (has all expected inputs filled).
 *
 * A row is considered ready when all expected columns (from linked runnable's input ports)
 * have non-empty values. This helps users identify which testcases need attention.
 *
 * Returns: { isReady: boolean, missingKeys: string[] }
 */
const rowReadyStateAtomFamily = atomFamily(
    ({loadableId, rowId}: {loadableId: string; rowId: string}) =>
        atom((get) => {
            // Get expected columns from linked runnable
            const expectedColumns = get(loadableColumnsFromRunnableAtomFamily(loadableId))
            const expectedKeys = expectedColumns.map((c) => c.key)

            if (expectedKeys.length === 0) {
                return {isReady: true, missingKeys: []}
            }

            // Get the row data (nested format - data fields in .data)
            const rowEntity = get(testcaseMolecule.data(rowId))
            if (!rowEntity) {
                return {isReady: false, missingKeys: expectedKeys}
            }

            // Check which expected keys are missing or empty
            // Note: Testcase uses nested format - data fields are in entity.data
            const rowData = rowEntity.data ?? {}
            const missingKeys: string[] = []
            for (const key of expectedKeys) {
                const value = rowData[key]
                const isEmpty =
                    value === undefined ||
                    value === null ||
                    value === "" ||
                    (typeof value === "string" && value.trim() === "")
                if (isEmpty) {
                    missingKeys.push(key)
                }
            }

            return {
                isReady: missingKeys.length === 0,
                missingKeys,
            }
        }),
)

/**
 * Row state indicator: whether the execution result is "stale" (inputs changed since execution).
 *
 * Compares current testcase input data against the inputs stored in the linked trace.
 * If any expected input value differs, the execution is considered stale.
 *
 * Returns: { isStale: boolean, changedKeys: string[] } or null if no execution result
 */
const rowExecutionStaleStateAtomFamily = atomFamily(
    ({loadableId, rowId}: {loadableId: string; rowId: string}) =>
        atom((get) => {
            const state = get(loadableStateAtomFamily(loadableId))
            const executionResult = state.executionResults[rowId]

            // No execution result = not applicable
            if (!executionResult || !executionResult.traceId) {
                return null
            }

            // Get expected columns (we only care about input changes for these)
            const expectedColumns = get(loadableColumnsFromRunnableAtomFamily(loadableId))
            const expectedKeys = expectedColumns.map((c) => c.key)

            if (expectedKeys.length === 0) {
                return {isStale: false, changedKeys: []}
            }

            // Get current row data (nested format - data fields in .data)
            const currentRowEntity = get(testcaseMolecule.data(rowId))
            if (!currentRowEntity) {
                return {isStale: true, changedKeys: expectedKeys}
            }

            // Get trace data to extract the inputs used during execution
            const traceSummary = get(traceDataSummaryAtomFamily(executionResult.traceId))

            // If trace is still loading, assume not stale (will update when loaded)
            if (traceSummary.isPending) {
                return {isStale: false, changedKeys: []}
            }

            // Extract inputs from trace's agData
            // The structure is: ag.data.inputs.inputs.{key} (double nested inputs)
            // extractAgData returns ag.data, so we access .inputs.inputs
            const agDataInputs = traceSummary.agData?.inputs as Record<string, unknown> | undefined
            // The actual input values are nested under another "inputs" key
            const traceInputs = (agDataInputs?.inputs ?? agDataInputs) as
                | Record<string, unknown>
                | undefined

            // If no trace inputs available, can't determine staleness
            if (!traceInputs) {
                return {isStale: false, changedKeys: []}
            }

            // Compare current values vs trace inputs for expected keys
            // Note: Testcase uses nested format - data fields are in entity.data
            const currentRowData = currentRowEntity.data ?? {}
            const changedKeys: string[] = []
            for (const key of expectedKeys) {
                const currentValue = currentRowData[key]
                const traceValue = traceInputs[key]

                // Normalize for comparison (treat undefined/null/empty as equivalent)
                const normalizedCurrent =
                    currentValue === undefined || currentValue === null ? "" : String(currentValue)
                const normalizedTrace =
                    traceValue === undefined || traceValue === null ? "" : String(traceValue)

                if (normalizedCurrent !== normalizedTrace) {
                    changedKeys.push(key)
                }
            }

            return {
                isStale: changedKeys.length > 0,
                changedKeys,
            }
        }),
)

/**
 * Row state indicator: whether output mapping would overwrite existing testcase data.
 *
 * This is a DERIVED selector that compares:
 * - Original testcase data from testcaseMolecule
 * - Derived output values from execution results + mappings
 *
 * If derived output values would overwrite non-empty existing values,
 * this returns information about which columns are affected.
 *
 * Returns: { hasOverrides, overriddenColumns, originalValues } or null if no overrides
 */
const rowOutputMappingOverrideStateAtomFamily = atomFamily(
    ({loadableId, rowId}: {loadableId: string; rowId: string}) =>
        atom((get) => {
            const state = get(loadableStateAtomFamily(loadableId))

            // Check if output mapping is disabled for this row
            const isDisabled = state.disabledOutputMappingRowIds.has(rowId)

            // Get derived output values (what would be applied from execution results)
            const derivedValues = get(derivedOutputValuesAtomFamily({loadableId, rowId}))

            if (!derivedValues || Object.keys(derivedValues).length === 0) {
                return null
            }

            // Get original testcase data (before any output mapping)
            // Note: Testcase uses nested format - data fields are in entity.data
            const originalEntity = get(testcaseMolecule.data(rowId))

            if (!originalEntity) {
                return null
            }

            // Compare: find columns where derived value would overwrite existing non-empty value
            const originalData = originalEntity.data ?? {}
            const overriddenColumns: string[] = []
            const originalValues: Record<string, unknown> = {}

            for (const [columnKey, derivedValue] of Object.entries(derivedValues)) {
                const originalValue = originalData[columnKey]

                // Check if original has a meaningful value that differs from derived
                const hasOriginalValue =
                    originalValue !== undefined &&
                    originalValue !== null &&
                    originalValue !== "" &&
                    String(originalValue).trim() !== ""

                const valuesDiffer = hasOriginalValue && originalValue !== derivedValue

                if (valuesDiffer) {
                    overriddenColumns.push(columnKey)
                    originalValues[columnKey] = originalValue
                }
            }

            if (overriddenColumns.length === 0) {
                return null
            }

            return {
                hasOverrides: true,
                isDisabled,
                overriddenColumns,
                originalValues,
            }
        }),
)

/**
 * Default output mappings derived from the linked runnable's output schema.
 *
 * For Agenta traces, output data is stored at `data.outputs.<key>` path.
 * This selector creates suggested mappings based on the runnable's outputPorts,
 * allowing users to see and configure mappings before running any executions.
 *
 * Example: If the runnable has outputPorts [{key: 'response', ...}],
 * this returns a suggested mapping: data.outputs.response → correct_answer
 */
const defaultOutputMappingsAtomFamily = atomFamily((loadableId: string) =>
    atom((get) => {
        const state = get(loadableStateAtomFamily(loadableId))
        const {linkedRunnableType, linkedRunnableId} = state

        // Need a linked runnable to derive default mappings
        if (!linkedRunnableType || !linkedRunnableId) {
            return []
        }

        // Get output ports from the linked runnable via the molecule abstraction
        let outputPorts: {key: string; name?: string; type?: string}[] = []
        if (linkedRunnableType === "appRevision") {
            // Use the molecule's outputPorts selector (derives from schema query)
            outputPorts = get(appRevisionMolecule.selectors.outputPorts(linkedRunnableId))
        }
        // TODO(evaluator-output-ports): Add evaluatorRevision support when backend provides
        // evaluator output schema. Will need evaluatorRevisionMolecule.selectors.outputPorts
        // similar to appRevisionMolecule. Blocked on backend API support.

        // For simple outputs, use data.outputs directly
        // The trace data typically stores the output at data.outputs (not data.outputs.{key})
        // Only use data.outputs.{key} for complex outputs with multiple distinct ports
        // Note: Even if schema defines ports, the actual trace data often uses data.outputs directly
        const useDirectOutputPath = true // Always use data.outputs for now - trace data structure

        // Create a SINGLE default mapping for the primary output → correct_answer
        // Users can customize/add more mappings after running an execution
        const outputPath = useDirectOutputPath
            ? "data.outputs"
            : `data.outputs.${outputPorts[0]?.key || "output"}`

        return [
            {
                outputPath,
                suggestedTargetColumn: "correct_answer",
                outputPortKey: outputPorts[0]?.key || "output",
                outputPortName: outputPorts[0]?.name || outputPorts[0]?.key || "Output",
            },
        ]
    }),
)

/**
 * Available output paths - combines schema-derived paths with execution-derived paths.
 * This allows showing available paths even before running executions.
 */
const availableOutputPathsWithSchemaAtomFamily = atomFamily((loadableId: string) =>
    atom((get) => {
        // Get paths from execution results (existing behavior)
        const executionPaths = get(availableOutputPathsAtomFamily(loadableId))

        // Get default mappings from schema
        const defaultMappings = get(defaultOutputMappingsAtomFamily(loadableId))
        const schemaPaths = defaultMappings.map((m) => m.outputPath)

        // Combine and deduplicate
        const allPaths = new Set([...schemaPaths, ...executionPaths])
        return Array.from(allPaths)
    }),
)

/**
 * Apply output mappings to a single row's testcase.
 * Updates the testcase draft with values extracted from execution results.
 *
 * Note: Override detection is now handled by rowOutputMappingOverrideStateAtomFamily
 * which is a derived selector comparing testcase data vs output values.
 */
const applyOutputMappingToRowAtom = atom(null, (get, set, loadableId: string, rowId: string) => {
    const state = get(loadableStateAtomFamily(loadableId))

    // Only works in connected mode
    if (!state.connectedSourceId) return false

    const outputValues = get(derivedOutputValuesAtomFamily({loadableId, rowId}))
    if (!outputValues) return false

    // Update testcase with output values via molecule
    // Pass data wrapped in {data: ...} to match Testcase nested format
    set(testcaseMolecule.actions.update, rowId, {data: outputValues})
    return true
})

/**
 * Apply output mappings to all rows that have execution results.
 * Returns the number of rows updated.
 */
const applyOutputMappingsToAllAtom = atom(null, (get, set, loadableId: string) => {
    const state = get(loadableStateAtomFamily(loadableId))

    // Only works in connected mode
    if (!state.connectedSourceId) return 0

    const mappings = state.outputMappings ?? []
    if (mappings.length === 0) return 0

    let updatedCount = 0
    const rowIds = Object.keys(state.executionResults)

    for (const rowId of rowIds) {
        const result = set(applyOutputMappingToRowAtom, loadableId, rowId)
        if (result) updatedCount++
    }

    return updatedCount
})

/**
 * Disable output mapping for a single row.
 * When disabled, the row displays original testcase data instead of
 * derived output values from execution results.
 *
 * This is a toggle - calling it again re-enables output mapping.
 */
const revertOutputMappingOverridesAtom = atom(
    null,
    (get, set, loadableId: string, rowId: string) => {
        const state = get(loadableStateAtomFamily(loadableId))
        const disabledSet = new Set(state.disabledOutputMappingRowIds)

        if (disabledSet.has(rowId)) {
            // Re-enable output mapping for this row
            disabledSet.delete(rowId)
        } else {
            // Disable output mapping for this row
            disabledSet.add(rowId)
        }

        set(loadableStateAtomFamily(loadableId), {
            ...state,
            disabledOutputMappingRowIds: disabledSet,
        })

        return true
    },
)

/**
 * Get column keys that are targets of output mappings but don't exist yet.
 * These are "new columns from outputs" that will be created.
 */
const newColumnsFromOutputMappingsAtomFamily = atomFamily((loadableId: string) =>
    atom((get) => {
        const state = get(loadableStateAtomFamily(loadableId))
        const mappings = state.outputMappings ?? []

        // Get existing column keys
        const existingColumns = get(loadableColumnsFromRunnableAtomFamily(loadableId))
        const existingKeys = new Set(existingColumns.map((c) => c.key))

        // Also check testcase data for existing columns
        if (state.connectedSourceId) {
            const displayRowIds = get(testcaseMolecule.atoms.displayRowIds)
            if (displayRowIds.length > 0) {
                const firstRow = get(testcaseMolecule.selectors.serverData(displayRowIds[0]))
                if (firstRow) {
                    Object.keys(firstRow).forEach((key) => {
                        if (key !== "id" && key !== "flags" && key !== "tags" && key !== "meta") {
                            existingKeys.add(key)
                        }
                    })
                }
            }
        }

        // Find mapping target columns that don't exist yet
        return mappings
            .filter((m) => m.targetColumn && !existingKeys.has(m.targetColumn))
            .map((m) => m.targetColumn)
    }),
)

/**
 * Initialize output mappings from the linked runnable's output schema.
 * Creates default mappings if none exist yet.
 *
 * This allows users to see and configure mappings before running any executions.
 */
const initializeDefaultOutputMappingsAtom = atom(null, (get, set, loadableId: string) => {
    const state = get(loadableStateAtomFamily(loadableId))

    // Don't overwrite existing mappings
    if (state.outputMappings.length > 0) {
        return
    }

    // Get default mappings from schema
    const defaultMappings = get(defaultOutputMappingsAtomFamily(loadableId))

    if (defaultMappings.length === 0) {
        return
    }

    // Create actual OutputMapping objects from the defaults
    const newMappings: OutputMapping[] = defaultMappings.map((dm) => ({
        id: createOutputMappingId(),
        outputPath: dm.outputPath,
        targetColumn: dm.suggestedTargetColumn,
        isNewColumn: true, // These columns likely don't exist yet
    }))

    // Update state with new mappings
    set(loadableStateAtomFamily(loadableId), {
        ...state,
        outputMappings: newMappings,
    })

    // For new columns, add them to testcase data so they appear in the UI
    // This is similar to what addColumnAtom does
    const displayRowIds = get(testcaseMolecule.atoms.displayRowIds)
    for (const mapping of newMappings) {
        if (mapping.isNewColumn && mapping.targetColumn) {
            // Add empty value to all testcase rows
            for (const rowId of displayRowIds) {
                set(testcaseMolecule.actions.update, rowId, {[mapping.targetColumn]: ""})
            }
        }
    }
})

// ============================================================================
// SYNC ACTIONS
// ============================================================================

/**
 * Sync new columns from loadable to testset's pending column ops.
 * This ensures new columns from prompt template changes are tracked
 * by the testset mutation system and appear in the commit diff.
 *
 * Also cleans up pending adds for columns that were removed from the config
 * (e.g., user adds a variable then removes it before committing).
 *
 * Should be called before opening the commit modal.
 */
const syncNewColumnsToTestsetAtom = atom(null, (get, set, loadableId: string) => {
    const state = get(loadableStateAtomFamily(loadableId))

    // Only sync when connected to a source
    if (!state.connectedSourceId) return

    // Get the current revision ID (the connected source is a revision)
    const revisionId = state.connectedSourceId

    // Get new column keys that need to be synced
    const newKeys = get(newColumnKeysAtomFamily(loadableId))
    const newKeysSet = new Set(newKeys)

    // Get existing pending column ops
    const pendingOps = get(pendingColumnOpsAtomFamily(revisionId))
    const existingAdds = pendingOps?.add ?? []

    // Find which keys aren't already in pending adds
    const existingAddsSet = new Set(existingAdds)
    const keysToAdd = newKeys.filter((key) => !existingAddsSet.has(key))

    // Find which pending adds are no longer in new keys (column was removed from config)
    // Only remove columns that were dynamically added (not original server columns)
    const keysToRemoveFromPending = existingAdds.filter((key) => !newKeysSet.has(key))

    // Check if any changes are needed
    const hasAdditions = keysToAdd.length > 0
    const hasRemovals = keysToRemoveFromPending.length > 0

    if (!hasAdditions && !hasRemovals) return

    // Build updated adds list: existing adds minus removed + new keys
    const updatedAdds = hasRemovals
        ? existingAdds.filter((key) => newKeysSet.has(key))
        : existingAdds

    // Update pending column ops
    set(pendingColumnOpsAtomFamily(revisionId), {
        rename: pendingOps?.rename ?? [],
        add: hasAdditions ? [...updatedAdds, ...keysToAdd] : updatedAdds,
        remove: pendingOps?.remove ?? [],
    })

    // Also set the current revision ID atom to ensure the changes summary reads from the right revision
    const currentRevId = get(currentRevisionIdAtom)
    if (currentRevId !== revisionId) {
        set(setCurrentRevisionIdAtom, revisionId)
    }
})

// ============================================================================
// CONTROLLER EXPORT
// ============================================================================

/**
 * Testset loadable controller
 */
export const testsetLoadable = {
    selectors: {
        /** Rows for a loadable - uses bridge atom when connected */
        rows: (loadableId: string) =>
            atom((get) => {
                // Trigger auto-init of output mappings when conditions are met
                // This ensures the effect runs reactively when rows are accessed
                get(autoInitOutputMappingsEffectAtomFamily(loadableId))
                return get(connectedRowsAtomFamily(loadableId))
            }),

        /** Columns for a loadable - derives from linked runnable when linked */
        columns: (loadableId: string) => loadableColumnsFromRunnableAtomFamily(loadableId),

        /** All columns for a loadable (from state, not filtered by runnable) */
        allColumns: (loadableId: string) => loadableColumnsAtomFamily(loadableId),

        /** Active row ID for a loadable */
        activeRow: (loadableId: string) =>
            atom((get) => get(loadableStateAtomFamily(loadableId)).activeRowId),

        /** Row count for a loadable (visible rows only) */
        rowCount: (loadableId: string) =>
            atom((get) => get(displayRowIdsAtomFamily(loadableId)).length),

        /** Display row IDs for a loadable (filters out hidden testcases) */
        displayRowIds: (loadableId: string) => displayRowIdsAtomFamily(loadableId),

        /** Total row count including hidden testcases */
        totalRowCount: (loadableId: string) => totalRowCountAtomFamily(loadableId),

        /** All rows including hidden ones (for Edit Testcase Selection modal) */
        allRowsIncludingHidden: (loadableId: string) =>
            allRowsIncludingHiddenAtomFamily(loadableId),

        /** Mode for a loadable */
        mode: (loadableId: string) => loadableModeAtomFamily(loadableId),

        /** Is dirty for a loadable */
        isDirty: (loadableId: string) => connectedHasLocalChangesAtomFamily(loadableId),

        /** Has local changes for a loadable */
        hasLocalChanges: (loadableId: string) => connectedHasLocalChangesAtomFamily(loadableId),

        /** Column keys that are new (added from runnable but not in original testcase data) */
        newColumnKeys: (loadableId: string) => newColumnKeysAtomFamily(loadableId),

        /** Execution results for a loadable */
        executionResults: (loadableId: string) => loadableExecutionResultsAtomFamily(loadableId),

        /** Full data for a loadable */
        data: (loadableId: string) => loadableDataAtomFamily(loadableId),

        /** Connected source for a loadable */
        connectedSource: (loadableId: string) => loadableConnectedSourceAtomFamily(loadableId),

        /** Linked runnable for a loadable */
        linkedRunnable: (loadableId: string) => loadableLinkedRunnableAtomFamily(loadableId),

        /** Name for a loadable (for new testset or connected source name) */
        name: (loadableId: string) => loadableNameAtomFamily(loadableId),

        /**
         * Whether the linked runnable supports dynamic inputs.
         * This is a placeholder - actual value should come from the runnable's schema.
         * Returns false by default.
         */
        supportsDynamicInputs: (_loadableId: string) =>
            atom((get) => {
                // This would need to be derived from the runnable's inputSchema.additionalProperties
                // For now, return false as a safe default
                void get
                return false
            }),

        /**
         * Derived column changes for commit context.
         * Returns columns added (from runnable) but not in server data.
         * Used by adapter layer to combine with core changesSummary.
         */
        derivedColumnChanges: (loadableId: string) => derivedColumnChangesAtomFamily(loadableId),

        // ======================================================================
        // OUTPUT MAPPING SELECTORS
        // ======================================================================

        /** Output mappings for a loadable */
        outputMappings: (loadableId: string) => loadableOutputMappingsAtomFamily(loadableId),

        /** Available output paths from execution results */
        availableOutputPaths: (loadableId: string) => availableOutputPathsAtomFamily(loadableId),

        /** Output data preview (agData) for showing values in mapping UI */
        outputDataPreview: (loadableId: string) => outputDataPreviewAtomFamily(loadableId),

        /** Whether any row has execution results with output */
        hasExecutionResults: (loadableId: string) => hasExecutionResultsAtomFamily(loadableId),

        /** Derived output values for a row based on mappings */
        derivedOutputValues: (loadableId: string, rowId: string) =>
            derivedOutputValuesAtomFamily({loadableId, rowId}),

        /** Column keys that are targets of output mappings but don't exist yet */
        newColumnsFromOutputMappings: (loadableId: string) =>
            newColumnsFromOutputMappingsAtomFamily(loadableId),

        /** Default output mappings derived from linked runnable's output schema */
        defaultOutputMappings: (loadableId: string) => defaultOutputMappingsAtomFamily(loadableId),

        /** Available output paths including schema-derived paths (works before executions) */
        availableOutputPathsWithSchema: (loadableId: string) =>
            availableOutputPathsWithSchemaAtomFamily(loadableId),

        // ======================================================================
        // ROW STATE INDICATOR SELECTORS
        // ======================================================================

        /** Row ready state: whether all expected inputs are filled */
        rowReadyState: (loadableId: string, rowId: string) =>
            rowReadyStateAtomFamily({loadableId, rowId}),

        /** Row execution stale state: whether inputs changed since last execution */
        rowExecutionStaleState: (loadableId: string, rowId: string) =>
            rowExecutionStaleStateAtomFamily({loadableId, rowId}),

        /** Row output mapping override state: whether row has overwritten values from auto-mapping */
        rowOutputMappingOverrideState: (loadableId: string, rowId: string) =>
            rowOutputMappingOverrideStateAtomFamily({loadableId, rowId}),
    },

    actions: {
        /** Add a row */
        addRow: addRowAtom,

        /** Update a row */
        updateRow: updateRowAtom,

        /** Remove a row */
        removeRow: removeRowAtom,

        /** Set active row */
        setActiveRow: setActiveRowAtom,

        /** Set all rows */
        setRows: setRowsAtom,

        /** Import testcases as new local rows (without changing connection) */
        importRows: importRowsAtom,

        /** Clear all rows */
        clearRows: clearRowsAtom,

        /** Set columns */
        setColumns: setColumnsAtom,

        /** Initialize with columns */
        initializeWithColumns: initializeWithColumnsAtom,

        /** Add a column */
        addColumn: addColumnAtom,

        /** Remove a column */
        removeColumn: removeColumnAtom,

        /** Connect to source */
        connectToSource: connectToSourceAtom,

        /** Disconnect from source */
        disconnect: disconnectAtom,

        /** Discard changes */
        discardChanges: discardChangesAtom,

        /** Commit changes */
        commitChanges: commitChangesAtom,

        /** Set name for a loadable (for new testset creation) */
        setName: setNameAtom,

        /** Save as new testset */
        saveAsNewTestset: saveAsNewTestsetAtom,

        /** Link to runnable */
        linkToRunnable: linkToRunnableAtom,

        /** Unlink from runnable */
        unlinkFromRunnable: unlinkFromRunnableAtom,

        /** Set row execution result */
        setRowExecutionResult: setRowExecutionResultAtom,

        /** Clear row execution result */
        clearRowExecutionResult: clearRowExecutionResultAtom,

        /** Sync new columns to testset's pending ops (call before commit) */
        syncNewColumnsToTestset: syncNewColumnsToTestsetAtom,

        /** Update testcase selection (for editing selection after connection) */
        updateTestcaseSelection: updateTestcaseSelectionAtom,

        // ======================================================================
        // OUTPUT MAPPING ACTIONS
        // ======================================================================

        /** Add an output mapping */
        addOutputMapping: addOutputMappingAtom,

        /** Remove an output mapping */
        removeOutputMapping: removeOutputMappingAtom,

        /** Update an output mapping */
        updateOutputMapping: updateOutputMappingAtom,

        /** Clear all output mappings */
        clearOutputMappings: clearOutputMappingsAtom,

        /** Apply output mappings to a single row */
        applyOutputMappingToRow: applyOutputMappingToRowAtom,

        /** Apply output mappings to all rows with results */
        applyOutputMappingsToAll: applyOutputMappingsToAllAtom,

        /** Initialize default output mappings from linked runnable's output schema */
        initializeDefaultOutputMappings: initializeDefaultOutputMappingsAtom,

        /** Revert output mapping overrides for a row (restore original values) */
        revertOutputMappingOverrides: revertOutputMappingOverridesAtom,
    },
}

// ============================================================================
// UNIFIED SELECTORS (entity-agnostic API)
// These dispatch to the appropriate entity based on connectedSourceType
// ============================================================================

/**
 * Unified selectors that dispatch based on source type.
 * Currently only 'testcase' is implemented; defaults to testcase for local mode.
 *
 * Usage:
 * ```typescript
 * const rows = useAtomValue(loadableController.selectors.rows(loadableId))
 * ```
 */
const unifiedSelectors = {
    /** Rows for a loadable - dispatches to appropriate entity */
    rows: (loadableId: string) => testsetLoadable.selectors.rows(loadableId),

    /** Columns for a loadable - derives from linked runnable */
    columns: (loadableId: string) => testsetLoadable.selectors.columns(loadableId),

    /** All columns for a loadable (from state, not filtered by runnable) */
    allColumns: (loadableId: string) => testsetLoadable.selectors.allColumns(loadableId),

    /** Active row ID for a loadable */
    activeRow: (loadableId: string) => testsetLoadable.selectors.activeRow(loadableId),

    /** Row count for a loadable (visible rows only) */
    rowCount: (loadableId: string) => testsetLoadable.selectors.rowCount(loadableId),

    /** Display row IDs for a loadable (filters out hidden items) */
    displayRowIds: (loadableId: string) => testsetLoadable.selectors.displayRowIds(loadableId),

    /** Total row count including hidden items */
    totalRowCount: (loadableId: string) => testsetLoadable.selectors.totalRowCount(loadableId),

    /** All rows including hidden ones */
    allRowsIncludingHidden: (loadableId: string) =>
        testsetLoadable.selectors.allRowsIncludingHidden(loadableId),

    /** Mode for a loadable */
    mode: (loadableId: string) => testsetLoadable.selectors.mode(loadableId),

    /** Is dirty for a loadable */
    isDirty: (loadableId: string) => testsetLoadable.selectors.isDirty(loadableId),

    /** Has local changes for a loadable */
    hasLocalChanges: (loadableId: string) => testsetLoadable.selectors.hasLocalChanges(loadableId),

    /** Column keys that are new (added but not in original data) */
    newColumnKeys: (loadableId: string) => testsetLoadable.selectors.newColumnKeys(loadableId),

    /** Execution results for a loadable */
    executionResults: (loadableId: string) =>
        testsetLoadable.selectors.executionResults(loadableId),

    /** Full data for a loadable */
    data: (loadableId: string) => testsetLoadable.selectors.data(loadableId),

    /** Connected source for a loadable */
    connectedSource: (loadableId: string) => testsetLoadable.selectors.connectedSource(loadableId),

    /** Linked runnable for a loadable */
    linkedRunnable: (loadableId: string) => testsetLoadable.selectors.linkedRunnable(loadableId),

    /** Name for a loadable */
    name: (loadableId: string) => testsetLoadable.selectors.name(loadableId),

    /** Whether the linked runnable supports dynamic inputs */
    supportsDynamicInputs: (loadableId: string) =>
        testsetLoadable.selectors.supportsDynamicInputs(loadableId),

    /** Derived column changes for commit context */
    derivedColumnChanges: (loadableId: string) =>
        testsetLoadable.selectors.derivedColumnChanges(loadableId),

    // Output mapping selectors
    outputMappings: (loadableId: string) => testsetLoadable.selectors.outputMappings(loadableId),
    availableOutputPaths: (loadableId: string) =>
        testsetLoadable.selectors.availableOutputPaths(loadableId),
    outputDataPreview: (loadableId: string) =>
        testsetLoadable.selectors.outputDataPreview(loadableId),
    hasExecutionResults: (loadableId: string) =>
        testsetLoadable.selectors.hasExecutionResults(loadableId),
    derivedOutputValues: (loadableId: string, rowId: string) =>
        testsetLoadable.selectors.derivedOutputValues(loadableId, rowId),
    newColumnsFromOutputMappings: (loadableId: string) =>
        testsetLoadable.selectors.newColumnsFromOutputMappings(loadableId),
    defaultOutputMappings: (loadableId: string) =>
        testsetLoadable.selectors.defaultOutputMappings(loadableId),
    availableOutputPathsWithSchema: (loadableId: string) =>
        testsetLoadable.selectors.availableOutputPathsWithSchema(loadableId),

    // Row state indicator selectors
    rowReadyState: (loadableId: string, rowId: string) =>
        testsetLoadable.selectors.rowReadyState(loadableId, rowId),
    rowExecutionStaleState: (loadableId: string, rowId: string) =>
        testsetLoadable.selectors.rowExecutionStaleState(loadableId, rowId),
    rowOutputMappingOverrideState: (loadableId: string, rowId: string) =>
        testsetLoadable.selectors.rowOutputMappingOverrideState(loadableId, rowId),
}

/**
 * Unified actions that dispatch based on source type.
 * Currently only 'testcase' is implemented.
 *
 * Usage:
 * ```typescript
 * const addRow = useSetAtom(loadableController.actions.addRow)
 * addRow(loadableId, { input: 'test' })
 * ```
 */
const unifiedActions = {
    // Row actions
    addRow: testsetLoadable.actions.addRow,
    updateRow: testsetLoadable.actions.updateRow,
    removeRow: testsetLoadable.actions.removeRow,
    setActiveRow: testsetLoadable.actions.setActiveRow,
    setRows: testsetLoadable.actions.setRows,
    importRows: testsetLoadable.actions.importRows,
    clearRows: testsetLoadable.actions.clearRows,

    // Column actions
    setColumns: testsetLoadable.actions.setColumns,
    initializeWithColumns: testsetLoadable.actions.initializeWithColumns,
    addColumn: testsetLoadable.actions.addColumn,
    removeColumn: testsetLoadable.actions.removeColumn,

    // Connection actions
    connectToSource: testsetLoadable.actions.connectToSource,
    disconnect: testsetLoadable.actions.disconnect,

    // Change management
    discardChanges: testsetLoadable.actions.discardChanges,
    commitChanges: testsetLoadable.actions.commitChanges,
    setName: testsetLoadable.actions.setName,
    saveAsNewTestset: testsetLoadable.actions.saveAsNewTestset,

    // Runnable linking
    linkToRunnable: testsetLoadable.actions.linkToRunnable,
    unlinkFromRunnable: testsetLoadable.actions.unlinkFromRunnable,

    // Execution
    setRowExecutionResult: testsetLoadable.actions.setRowExecutionResult,
    clearRowExecutionResult: testsetLoadable.actions.clearRowExecutionResult,

    // Testset sync
    syncNewColumnsToTestset: testsetLoadable.actions.syncNewColumnsToTestset,
    updateTestcaseSelection: testsetLoadable.actions.updateTestcaseSelection,

    // Output mapping actions
    addOutputMapping: testsetLoadable.actions.addOutputMapping,
    removeOutputMapping: testsetLoadable.actions.removeOutputMapping,
    updateOutputMapping: testsetLoadable.actions.updateOutputMapping,
    clearOutputMappings: testsetLoadable.actions.clearOutputMappings,
    applyOutputMappingToRow: testsetLoadable.actions.applyOutputMappingToRow,
    applyOutputMappingsToAll: testsetLoadable.actions.applyOutputMappingsToAll,
    initializeDefaultOutputMappings: testsetLoadable.actions.initializeDefaultOutputMappings,
    revertOutputMappingOverrides: testsetLoadable.actions.revertOutputMappingOverrides,
}

/**
 * Unified loadable controller
 *
 * Provides entity-agnostic API for UI components.
 * Dispatches to appropriate entity based on connectedSourceType.
 *
 * ## Usage
 *
 * ```typescript
 * import { loadableController } from '@agenta/entities/loadable'
 *
 * // Entity-agnostic API (recommended)
 * const rows = useAtomValue(loadableController.selectors.rows(loadableId))
 * const addRow = useSetAtom(loadableController.actions.addRow)
 * addRow(loadableId, { input: 'test' })
 *
 * // Entity-specific access (advanced use cases)
 * const derivedChanges = useAtomValue(
 *     loadableController.entities.testset.selectors.derivedColumnChanges(loadableId)
 * )
 * ```
 */
export const loadableController = {
    /**
     * Entity-agnostic selectors (recommended for UI)
     */
    selectors: unifiedSelectors,

    /**
     * Entity-agnostic actions (recommended for UI)
     */
    actions: unifiedActions,

    /**
     * Entity-specific access for advanced use cases
     * Use this when you need features specific to a source type
     */
    entities: {
        testset: testsetLoadable,
    },
}
