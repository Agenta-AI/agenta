import {atom} from "jotai"

import {addColumnAtom, currentColumnsAtom} from "@/oss/state/entities/testcase/columnState"
import {
    collectKeyPaths,
    extractAgData,
    filterDataPaths,
    matchColumnsWithSuggestions,
    spanToTraceData,
    traceSpan,
    type TraceSpan,
} from "@/oss/state/entities/trace"
import {
    resetSelectionAtom,
    selectedRevisionIdAtom as sharedSelectedRevisionIdAtom,
} from "@/oss/state/testsetSelection"

import {createMappingId, type Mapping, type TestsetTraceData} from "../assets/types"

import {
    cascaderValueAtom,
    isNewTestsetAtom,
    newTestsetNameAtom,
    selectedTestsetInfoAtom,
} from "./cascaderState"

/**
 * Drawer State Atoms
 *
 * Clean state management for TestsetDrawer using Jotai atoms.
 * Eliminates useEffect dependency cycles by using derived atoms.
 * Integrates with the trace span entity system for cross-component access.
 */

/**
 * Deeply normalize data for comparison.
 * Parses stringified JSON values and re-stringifies them consistently.
 * This ensures that formatting differences don't affect equality checks.
 */
function deepNormalizeForComparison(data: unknown): unknown {
    if (data === null || data === undefined) return data

    if (typeof data === "string") {
        // Try to parse as JSON and normalize
        try {
            const parsed = JSON.parse(data)
            // Re-stringify with consistent formatting
            return JSON.stringify(deepNormalizeForComparison(parsed))
        } catch {
            // Not JSON, return as-is
            return data
        }
    }

    if (Array.isArray(data)) {
        return data.map(deepNormalizeForComparison)
    }

    if (typeof data === "object") {
        const normalized: Record<string, unknown> = {}
        for (const key of Object.keys(data).sort()) {
            normalized[key] = deepNormalizeForComparison((data as Record<string, unknown>)[key])
        }
        return normalized
    }

    return data
}

// ============================================================================
// PRIMITIVE STATE ATOMS
// ============================================================================

/** Mapping configurations (trace paths -> testset columns) */
export const mappingDataAtom = atom<Mapping[]>([])

/** Trace data from observability/spans */
export const traceDataAtom = atom<TestsetTraceData[]>([])

/** Span IDs associated with current trace data (for entity lookup) */
export const traceSpanIdsAtom = atom<string[]>([])

/** Preview selection key ("all" or specific trace key) */
export const previewKeyAtom = atom<string>("all")

/** Row data preview key (specific trace key for editor preview) */
export const rowDataPreviewAtom = atom<string>("")

/** Current selected revision ID (re-export from shared module) */
export const selectedRevisionIdAtom = sharedSelectedRevisionIdAtom

/** Flag for duplicate column mappings */
export const hasDuplicateColumnsAtom = atom<boolean>(false)

/** Preview entity IDs (for cleanup) - stored in atom instead of useState */
export const previewEntityIdsAtom = atom<string[]>([])

// ============================================================================
// ENTITY-DERIVED TRACE DATA ATOM
// ============================================================================

/**
 * Derived: Trace data derived from entity controller
 *
 * This is the reactive source of truth for trace data. It reads from:
 * - traceSpanIdsAtom: list of span IDs to render
 * - traceSpan.selectors.data: entity state (server data + draft merged)
 * - traceSpan.selectors.isDirty: whether span has been edited
 * - traceSpan.selectors.query: query state with server data (for originalData field)
 *
 * When entities update (e.g., from fetch completing or drafts being set),
 * this atom automatically re-computes, and all dependent components re-render.
 *
 * This replaces the primitive traceDataAtom for most use cases.
 */
export const traceDataFromEntitiesAtom = atom((get): TestsetTraceData[] => {
    const spanIds = get(traceSpanIdsAtom)

    return spanIds.map((spanId, index) => {
        const entity = get(traceSpan.selectors.data(spanId))
        const isDirty = get(traceSpan.selectors.isDirty(spanId))

        if (!entity) {
            // Entity not yet loaded - return placeholder
            return {
                key: spanId,
                data: {},
                id: index + 1,
                isEdited: false,
                originalData: null,
            }
        }

        // Extract ag.data from entity attributes
        const agData = extractAgData(entity)

        // Get original data for comparison/revert if dirty
        let originalData: Record<string, any> | null = null
        if (isDirty) {
            const queryState = get(traceSpan.selectors.query(spanId))
            const serverData = queryState.data
            if (serverData) {
                originalData = extractAgData(serverData)
            }
        }

        return {
            key: spanId,
            data: agData,
            id: index + 1,
            isEdited: isDirty,
            originalData,
        }
    })
})

// ============================================================================
// DERIVED ATOMS (READ-ONLY)
// ============================================================================

/**
 * Derived: Check if any valid mappings exist
 */
export const hasValidMappingsAtom = atom((get) => {
    const mappings = get(mappingDataAtom)
    return mappings.some((mapping) => {
        const targetKey =
            mapping.column === "create" || !mapping.column ? mapping.newColumn : mapping.column
        return !!targetKey
    })
})

/**
 * Derived: Filtered trace data based on preview selection
 * Uses entity-derived trace data for reactive updates
 */
export const filteredTraceDataAtom = atom((get) => {
    const traceData = get(traceDataFromEntitiesAtom)
    const previewKey = get(previewKeyAtom)

    if (previewKey === "all") {
        return traceData
    }

    return traceData.filter((trace) => trace.key === previewKey)
})

/**
 * Derived: Selected trace data for editor preview
 * Returns the trace matching rowDataPreviewAtom key
 * Uses entity-derived trace data for reactive updates
 */
export const selectedTraceDataAtom = atom((get) => {
    const traceData = get(traceDataFromEntitiesAtom)
    const rowDataPreview = get(rowDataPreviewAtom)

    if (!rowDataPreview) {
        return traceData[0]
    }

    return traceData.find((trace) => trace.key === rowDataPreview)
})

/**
 * Derived: Index of current preview in trace data array
 * Uses entity-derived trace data for reactive updates
 */
export const selectedTraceIndexAtom = atom((get) => {
    const traceData = get(traceDataFromEntitiesAtom)
    const rowDataPreview = get(rowDataPreviewAtom)

    if (!rowDataPreview || traceData.length === 0) {
        return 0
    }

    const index = traceData.findIndex((trace) => trace.key === rowDataPreview)
    return index >= 0 ? index : 0
})

/**
 * Derived: Active column names from mappings
 */
export const mappingColumnNamesAtom = atom((get) => {
    const mappings = get(mappingDataAtom)
    return mappings
        .map((m) => (m.column === "create" || !m.column ? m.newColumn : m.column))
        .filter((col): col is string => !!col)
})

// ============================================================================
// TRACE DATA ACTIONS
// ============================================================================

/**
 * Write atom: Remove a trace from trace data and update preview selection
 * Automatically selects the next available trace for preview
 *
 * Works with entity system by updating traceSpanIdsAtom.
 * The traceDataFromEntitiesAtom will automatically reflect the change.
 */
export const removeTraceDataAtom = atom(null, (get, set, traceKey: string) => {
    const spanIds = get(traceSpanIdsAtom)
    const previewKey = get(previewKeyAtom)

    // Find current index before removal
    const currentIndex = spanIds.findIndex((id) => id === traceKey)

    // Filter out the span to remove
    const remainingSpanIds = spanIds.filter((id) => id !== traceKey)
    set(traceSpanIdsAtom, remainingSpanIds)

    // Discard any draft for the removed span
    set(traceSpan.actions.discard, traceKey)

    if (remainingSpanIds.length > 0) {
        // Find the next span to preview
        const nextSpanId =
            remainingSpanIds[currentIndex] ||
            remainingSpanIds[currentIndex - 1] ||
            remainingSpanIds[0]

        set(rowDataPreviewAtom, nextSpanId)

        // Also update previewKey if it was the removed trace
        if (traceKey === previewKey) {
            set(previewKeyAtom, nextSpanId)
        }
    } else {
        set(rowDataPreviewAtom, "")
    }

    return remainingSpanIds
})

/**
 * Write atom: Initialize drawer with span IDs
 * Entity atoms will fetch the actual span data from the backend.
 * This is the preferred way to initialize the drawer.
 *
 * Flow:
 * 1. Store span IDs in traceSpanIdsAtom
 * 2. Components read from traceSpan.selectors.data(spanId) which triggers fetch
 * 3. traceDataFromEntitiesAtom derives data from entity controller (reactive)
 *
 * Note: traceDataAtom is deprecated - use traceDataFromEntitiesAtom instead
 */
export const initializeWithSpanIdsAtom = atom(null, (_get, set, spanIds: string[]) => {
    if (spanIds.length === 0) {
        return
    }

    // Store span IDs - entity atoms will handle fetching
    // traceDataFromEntitiesAtom will automatically derive the data
    set(traceSpanIdsAtom, spanIds)
    set(rowDataPreviewAtom, spanIds[0] || "")
    set(previewKeyAtom, spanIds[0] || "all")
})

/**
 * Write atom: Initialize trace data from input data (legacy)
 * @deprecated Use initializeWithSpanIdsAtom instead - pass span IDs and let entity atoms fetch data
 */
export const initializeTraceDataAtom = atom(null, (_get, set, data: TestsetTraceData[]) => {
    if (data.length === 0) {
        return
    }

    set(traceDataAtom, data)
    set(rowDataPreviewAtom, data[0]?.key || "")
    set(previewKeyAtom, data[0]?.key || "all")

    const spanIds = data.map((trace) => trace.key).filter(Boolean)
    set(traceSpanIdsAtom, spanIds)
})

/**
 * Primitive: Drawer open state
 */
export const isDrawerOpenAtom = atom<boolean>(false)

/**
 * Write atom: Open the testset drawer with trace data
 *
 * @deprecated Use initializeWithSpanIdsAtom instead - pass span IDs and let entity atoms fetch data
 *
 * This is the legacy entry point that accepts pre-built trace data.
 * Prefer using initializeWithSpanIdsAtom with span IDs for the entity-based approach.
 *
 * Usage (in parent):
 *   const openDrawer = useSetAtom(openDrawerAtom)
 *   openDrawer(selectedSpans)
 */
export const openDrawerAtom = atom(null, (_get, set, data: TestsetTraceData[]) => {
    if (data.length === 0) {
        return
    }

    // Extract span IDs and use the entity-based initialization
    const spanIds = data.map((trace) => trace.key).filter(Boolean)
    set(traceSpanIdsAtom, spanIds)
    set(rowDataPreviewAtom, data[0]?.key || "")
    set(previewKeyAtom, data[0]?.key || "all")

    // Open the drawer
    set(isDrawerOpenAtom, true)
})

/**
 * Write atom: Open the testset drawer with span IDs
 *
 * Accepts an array of span IDs and sets them for entity-based fetching.
 * The traceDataFromEntitiesAtom will automatically derive the data.
 *
 * Usage:
 *   const openDrawerWithSpanIds = useSetAtom(openDrawerWithSpanIdsAtom)
 *   openDrawerWithSpanIds(['span-id-1', 'span-id-2'])
 */
export const openDrawerWithSpanIdsAtom = atom(null, (_get, set, spanIds: string[]) => {
    if (spanIds.length === 0) {
        return
    }

    // Store span IDs - entity atoms will handle fetching
    // traceDataFromEntitiesAtom will automatically derive the data
    set(traceSpanIdsAtom, spanIds)
    set(rowDataPreviewAtom, spanIds[0] || "")
    set(previewKeyAtom, spanIds[0] || "all")

    // Open the drawer
    set(isDrawerOpenAtom, true)
})

/**
 * Write atom: Close the testset drawer and reset ALL state
 *
 * This is a comprehensive reducer that resets all drawer-related state.
 * Called directly from user action (close button), NOT from useEffect.
 *
 * NOTE: Save state and local entities are reset via their own atoms
 * which should be called from the hook to avoid circular imports.
 */
export const closeDrawerAtom = atom(null, (_get, set) => {
    set(isDrawerOpenAtom, false)

    // Reset span IDs (traceDataFromEntitiesAtom will automatically return [])
    set(traceSpanIdsAtom, [])
    set(rowDataPreviewAtom, "")
    set(previewKeyAtom, "all")

    // Reset mapping data
    set(mappingDataAtom, [])
    set(hasDuplicateColumnsAtom, false)

    // Reset local columns
    set(localColumnsAtom, [])

    // Reset auto-mapping tracking
    set(autoMappedTestsetIdAtom, null)

    // Reset cascader-specific UI state
    set(cascaderValueAtom, [])
    set(newTestsetNameAtom, "")

    // Reset shared selection state (testset, revision, etc.)
    set(resetSelectionAtom)
})

/**
 * Write atom: Reset state before cascader change
 *
 * Resets mapping and local state while preserving trace data.
 * Called as part of onCascaderChangeAtom flow.
 */
export const resetForCascaderChangeAtom = atom(null, (get, set) => {
    const spanIds = get(traceSpanIdsAtom)

    // Reset mapping data (preserve structure, clear values)
    set(
        mappingDataAtom,
        get(mappingDataAtom).map((item) => ({...item, column: "", newColumn: ""})),
    )

    // Reset preview to first span
    set(previewKeyAtom, spanIds[0] || "all")

    // Reset local columns
    set(localColumnsAtom, [])

    // Reset auto-mapping tracking
    set(autoMappedTestsetIdAtom, null)
})

/**
 * Write atom: Update trace data from editor
 *
 * Uses the entity draft system to update span data.
 * The edit is stored as a draft on the entity's attributes (ag.data).
 * The traceDataFromEntitiesAtom will automatically reflect the change via isDirty.
 *
 * Also updates local entities to reflect the edited data in the preview table.
 */
export const updateEditedTraceAtom = atom(
    null,
    (
        get,
        set,
        params: {
            updatedData: string
            format: "JSON" | "YAML"
            parseYaml: (str: string) => unknown
            formatData?: (format: "JSON" | "YAML", data: unknown) => string
            getValueAtPath?: (obj: unknown, path: string) => unknown
        },
    ) => {
        const {updatedData, format, parseYaml, getValueAtPath} = params
        const spanId = get(rowDataPreviewAtom)
        const currentEntity = get(traceSpan.selectors.data(spanId))
        const queryState = get(traceSpan.selectors.query(spanId))
        const serverState = queryState.data

        console.log("[updateEditedTraceAtom] Called", {
            hasUpdatedData: !!updatedData,
            spanId,
            hasEntity: !!currentEntity,
            hasGetValueAtPath: !!getValueAtPath,
        })

        if (!updatedData || !spanId || !currentEntity) {
            console.log("[updateEditedTraceAtom] Early return - no data or entity")
            return {success: false, error: "No data to update"}
        }

        try {
            // Parse the updated data
            const parsedUpdatedData =
                typeof updatedData === "string"
                    ? format === "YAML"
                        ? parseYaml(updatedData)
                        : JSON.parse(updatedData)
                    : updatedData

            // Extract the data property (editor wraps in {data: ...})
            const newAgData = (parsedUpdatedData as {data: Record<string, any>}).data

            console.log("[updateEditedTraceAtom] Parsed data", {
                newAgData,
            })

            // Get current and original ag.data for comparison
            const currentAgData = extractAgData(currentEntity)
            const originalAgData = serverState ? extractAgData(serverState) : currentAgData

            // Deep normalize for comparison
            const normalizedUpdated = deepNormalizeForComparison(newAgData)
            const normalizedCurrent = deepNormalizeForComparison(currentAgData)
            const normalizedOriginal = deepNormalizeForComparison(originalAgData)

            const updatedString = JSON.stringify(normalizedUpdated)
            const currentString = JSON.stringify(normalizedCurrent)
            const originalString = JSON.stringify(normalizedOriginal)

            console.log("[updateEditedTraceAtom] Comparing data", {
                updatedPreview: updatedString.slice(0, 100),
                currentPreview: currentString.slice(0, 100),
                isEqual: updatedString === currentString,
            })

            // No change
            if (updatedString === currentString) {
                console.log("[updateEditedTraceAtom] No changes detected")
                return {success: false, error: "No changes detected"}
            }

            // If reverting to original, discard draft instead
            if (updatedString === originalString) {
                console.log("[updateEditedTraceAtom] Reverting to original - discarding draft")
                set(traceSpan.actions.discard, spanId)
            } else {
                // Update entity draft with new ag.data
                // The draft system expects attributes, so we build the new attributes
                const newAttributes = {
                    ...currentEntity.attributes,
                    "ag.data": newAgData,
                }

                console.log("[updateEditedTraceAtom] Setting entity draft", {spanId})
                set(traceSpan.actions.update, spanId, newAttributes)
            }

            // Update local entities to reflect the edited data in preview table
            if (getValueAtPath) {
                const mappings = get(mappingDataAtom)
                const traceData = get(traceDataFromEntitiesAtom)

                console.log("[updateEditedTraceAtom] Updating local entities", {
                    mappingsCount: mappings.length,
                })

                // eslint-disable-next-line @typescript-eslint/no-require-imports
                const {updateAllLocalEntitiesAtom} = require("./localEntities")
                set(updateAllLocalEntitiesAtom, {
                    traceData,
                    mappings,
                    getValueAtPath,
                })
                console.log("[updateEditedTraceAtom] Local entities updated")
            }

            return {success: true}
        } catch (error) {
            console.error("[updateEditedTraceAtom] Error", error)
            return {
                success: false,
                error: format === "YAML" ? "Invalid YAML format" : "Invalid JSON format",
            }
        }
    },
)

/**
 * Write atom: Revert trace data to original (before edits)
 *
 * Uses the entity draft system to discard changes.
 * The traceDataFromEntitiesAtom will automatically reflect the revert via isDirty.
 *
 * Also updates local entities to reflect the reverted data in the preview table.
 */
export const revertEditedTraceAtom = atom(
    null,
    (
        get,
        set,
        params: {
            getValueAtPath?: (obj: unknown, path: string) => unknown
        },
    ) => {
        const {getValueAtPath} = params
        const spanId = get(rowDataPreviewAtom)
        const isDirty = get(traceSpan.selectors.isDirty(spanId))

        if (!spanId || !isDirty) {
            return {success: false, error: "No changes to revert"}
        }

        // Discard the entity draft to revert to server state
        set(traceSpan.actions.discard, spanId)

        console.log("[revertEditedTraceAtom] Discarded draft for span", spanId)

        // Update local entities to reflect the reverted data
        if (getValueAtPath) {
            const mappings = get(mappingDataAtom)
            const traceData = get(traceDataFromEntitiesAtom)

            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const {updateAllLocalEntitiesAtom} = require("./localEntities")
            set(updateAllLocalEntitiesAtom, {
                traceData,
                mappings,
                getValueAtPath,
            })
        }

        return {success: true}
    },
)

// ============================================================================
// SPAN ENTITY INTEGRATION
// ============================================================================

/**
 * Derived: Get span entities from cache for current trace data
 * Returns spans that exist in the entity cache, keyed by span_id
 */
export const cachedSpansAtom = atom((get) => {
    const spanIds = get(traceSpanIdsAtom)
    const spans = new Map<string, TraceSpan>()

    for (const spanId of spanIds) {
        const span = get(traceSpan.selectors.data(spanId))
        if (span) {
            spans.set(spanId, span)
        }
    }

    return spans
})

/**
 * Derived: Get a specific span from the entity cache
 * Usage: const span = useAtomValue(spanByIdAtomFamily(spanId))
 */
export const spanByIdAtomFamily = traceSpan.selectors.data

// ============================================================================
// AUTO-MAPPING DERIVED ATOMS
// ============================================================================

/**
 * Derived: All unique paths from trace data (unfiltered)
 * Used for autocomplete options in mapping UI
 * Includes object paths for manual selection
 * Uses entity-derived trace data for reactive updates
 */
export const allTracePathsAtom = atom((get) => {
    const traceData = get(traceDataFromEntitiesAtom)

    const uniquePaths = new Set<string>()
    traceData.forEach((traceItem) => {
        // Include object paths (true) so users can manually select them
        const traceKeys = collectKeyPaths(traceItem?.data, "data", true)
        traceKeys.forEach((key) => uniquePaths.add(key))
    })

    return Array.from(uniquePaths)
})

/**
 * Derived: All trace paths as select options format
 * Returns { value, label } pairs for use in AutoComplete/Select components
 */
export const allTracePathsSelectOptionsAtom = atom((get) => {
    const paths = get(allTracePathsAtom)
    return paths.map((path) => ({value: path, label: path}))
})

/**
 * Derived: Leaf-only paths from trace data (no intermediate object paths)
 * Used for auto-mapping logic to avoid duplicate column mappings
 * Uses entity-derived trace data for reactive updates
 */
export const leafTracePathsAtom = atom((get) => {
    const traceData = get(traceDataFromEntitiesAtom)

    const uniquePaths = new Set<string>()
    traceData.forEach((traceItem) => {
        // Don't include object paths (false) for auto-mapping
        const traceKeys = collectKeyPaths(traceItem?.data, "data", false)
        traceKeys.forEach((key) => uniquePaths.add(key))
    })

    return Array.from(uniquePaths)
})

/**
 * Derived: Filtered data paths from trace data (inputs/outputs/internals only)
 * Used for auto-mapping logic - uses leaf paths only to avoid duplicates
 */
export const traceDataPathsAtom = atom((get) => {
    const leafPaths = get(leafTracePathsAtom)
    return filterDataPaths(leafPaths)
})

/**
 * Derived: Available columns for mapping
 * Uses entity columns for existing testsets, empty for new testsets
 * (New testset columns are managed locally in the component)
 */
export const availableColumnsAtom = atom((get) => {
    const isNewTestset = get(isNewTestsetAtom)

    if (isNewTestset) {
        // For new testsets, columns are managed locally - return empty
        // The component will pass local columns when needed
        return []
    }

    // For existing testsets, use entity columns
    const columns = get(currentColumnsAtom)
    return columns.map((col) => col.key)
})

/**
 * Derived: Auto-generated mapping suggestions based on trace data paths and available columns
 * Returns suggested mappings that match data paths to existing or new columns
 */
export const autoMappingSuggestionsAtom = atom((get) => {
    const dataPaths = get(traceDataPathsAtom)
    const availableColumns = get(availableColumnsAtom)
    const testsetInfo = get(selectedTestsetInfoAtom)

    // Don't generate suggestions if no testset is selected
    if (!testsetInfo.id) {
        return []
    }

    // Generate suggestions using trace entity utilities
    const suggestions = dataPaths.map((path) => ({
        data: path,
        suggestedColumn: path.split(".").pop() || path,
    }))

    // Match with existing columns
    return matchColumnsWithSuggestions(suggestions, availableColumns)
})

/**
 * Primitive: Track which testset ID has been auto-mapped
 * This prevents re-applying auto-mapping when testset hasn't changed
 */
export const autoMappedTestsetIdAtom = atom<string | null>(null)

/**
 * Derived: Compute suggested mappings based on trace data and columns
 * This is a pure derivation - no side effects
 */
export const computedMappingSuggestionsAtom = atom((get) => {
    const dataPaths = get(traceDataPathsAtom)
    const testsetInfo = get(selectedTestsetInfoAtom)
    const isNewTestset = get(isNewTestsetAtom)
    const entityColumns = get(currentColumnsAtom)

    if (!testsetInfo.id || dataPaths.length === 0) {
        return {suggestions: [], newColumns: []}
    }

    // Get available columns from entity system
    const availableColumns = isNewTestset ? [] : entityColumns.map((col) => col.key)

    // Generate suggestions
    const suggestions = dataPaths.map((path) => ({
        data: path,
        suggestedColumn: path.split(".").pop() || path,
    }))

    // Match with columns
    const matchedMappings = matchColumnsWithSuggestions(suggestions, availableColumns)

    // Identify new columns that would be created
    const newColumns = matchedMappings
        .filter((m) => m.isNew && m.column)
        .map((m) => ({column: m.column, isNew: true}))

    return {suggestions: matchedMappings, newColumns}
})

/**
 * Primitive: Local testset columns for new testsets
 * Moved here to avoid circular dependency with saveState.ts
 */
export const localColumnsAtom = atom<{column: string; isNew: boolean}[]>([])

/**
 * Derived: Columns that need to be added to entity system
 * Compares local columns with entity columns to find missing ones
 */
export const columnsToSyncAtom = atom((get) => {
    const isNewTestset = get(isNewTestsetAtom)

    if (!isNewTestset) {
        return []
    }

    const localColumns = get(localColumnsAtom)
    const entityColumns = get(currentColumnsAtom)
    const entityColumnKeys = new Set(entityColumns.map((col) => col.key))

    return localColumns.filter((col) => !entityColumnKeys.has(col.column)).map((col) => col.column)
})

/**
 * Write atom: Apply auto-mapping and sync columns in one action
 * This replaces the two useEffects with a single declarative action
 */
export const applyAutoMappingAtom = atom(
    null,
    (get, set, options?: {localColumns?: string[]; force?: boolean}) => {
        const testsetInfo = get(selectedTestsetInfoAtom)
        const autoMappedId = get(autoMappedTestsetIdAtom)

        // Skip if already auto-mapped for this testset (unless forced)
        if (!options?.force && autoMappedId === testsetInfo.id) {
            return null
        }

        const dataPaths = get(traceDataPathsAtom)
        const isNewTestset = get(isNewTestsetAtom)
        const currentMappings = get(mappingDataAtom)

        if (!testsetInfo.id || dataPaths.length === 0) {
            return null
        }

        // Get columns - use local columns for new testsets, entity columns for existing
        const columns = isNewTestset
            ? options?.localColumns || []
            : get(currentColumnsAtom).map((col) => col.key)

        // Generate suggestions
        const suggestions = dataPaths.map((path) => ({
            data: path,
            suggestedColumn: path.split(".").pop() || path,
        }))

        // Match with columns
        const matchedMappings = matchColumnsWithSuggestions(suggestions, columns)

        // Convert to mapping format
        const newMappings: Mapping[] = matchedMappings.map((match, index) => {
            const existingMapping = currentMappings[index]
            return {
                // Use existing mapping ID if available, otherwise generate new one
                id: existingMapping?.id || createMappingId(),
                data: match.data,
                column: match.column,
                newColumn: existingMapping?.newColumn,
            }
        })

        // Only update mappings if different
        const isSame =
            newMappings.length === currentMappings.length &&
            currentMappings.every((item, index) => {
                const nextItem = newMappings[index]
                return (
                    item?.data === nextItem?.data &&
                    item?.column === nextItem?.column &&
                    item?.newColumn === nextItem?.newColumn
                )
            })

        if (!isSame) {
            set(mappingDataAtom, newMappings)
        }

        // Mark as auto-mapped for this testset
        set(autoMappedTestsetIdAtom, testsetInfo.id)

        return matchedMappings
    },
)

/**
 * Write atom: Sync local columns to entity system
 * Call this after local columns have been updated
 */
export const syncColumnsToEntityAtom = atom(null, (get, set) => {
    const columnsToSync = get(columnsToSyncAtom)

    if (columnsToSync.length === 0) {
        return
    }

    columnsToSync.forEach((columnName) => {
        set(addColumnAtom, columnName)
    })
})

/**
 * Write atom: Combined action to apply auto-mapping and update local columns
 * This is the main entry point for auto-mapping logic
 *
 * NOTE: We intentionally do NOT sync columns to the entity system here.
 * New columns from drawer mappings should only apply to local entities
 * (created from trace data), not to fetched testcases from the backend.
 * The column sync happens only when saving the testset.
 */
export const executeAutoMappingAtom = atom(null, (get, set) => {
    const testsetInfo = get(selectedTestsetInfoAtom)
    const autoMappedId = get(autoMappedTestsetIdAtom)

    // Skip if already auto-mapped for this testset
    if (autoMappedId === testsetInfo.id) {
        return null
    }

    const isNewTestset = get(isNewTestsetAtom)
    const localColumns = get(localColumnsAtom)

    // Apply auto-mapping
    const matchedMappings = set(applyAutoMappingAtom, {
        localColumns: localColumns.map((c) => c.column),
    })

    // For new testsets, update local columns based on matched mappings
    if (isNewTestset && matchedMappings && matchedMappings.length > 0) {
        const existingColumnsSet = new Set(localColumns.map((c) => c.column.toLowerCase()))

        const newColumns = matchedMappings
            .filter((m) => m.isNew && m.column && !existingColumnsSet.has(m.column.toLowerCase()))
            .map((m) => ({column: m.column, isNew: true}))

        if (newColumns.length > 0) {
            set(localColumnsAtom, [...localColumns, ...newColumns])
        }
    }

    // NOTE: We do NOT call syncColumnsToEntityAtom here.
    // New columns should only be applied to local entities, not fetched testcases.

    return matchedMappings
})

// ============================================================================
// UNIFIED SELECTION REDUCERS
// ============================================================================

/**
 * Derived: Check if trace data has structural differences
 * Uses entity-derived trace data for reactive updates
 */
export const hasDifferentStructureAtom = atom((get) => {
    const traceData = get(traceDataFromEntitiesAtom)
    if (traceData.length <= 1) return false

    const referencePaths = collectKeyPaths(traceData[0].data).sort().join(",")
    for (let i = 1; i < traceData.length; i++) {
        const currentPaths = collectKeyPaths(traceData[i].data).sort().join(",")
        if (currentPaths !== referencePaths) {
            return true
        }
    }
    return false
})

/**
 * Write atom: Handle testset selection in one atomic operation
 *
 * This reducer handles the flow when a testset is selected:
 * 1. Reads testset info from atoms (no params needed)
 * 2. Applies auto-mapping to derive column mappings from trace paths
 * 3. Updates local columns for new testsets
 *
 * Called directly from user action (onCascaderChange), NOT from useEffect.
 * All dependencies are read from atoms.
 */
export const onTestsetSelectAtom = atom(null, (get, set) => {
    const testsetInfo = get(selectedTestsetInfoAtom)
    const isNewTestset = get(isNewTestsetAtom)
    const traceData = get(traceDataFromEntitiesAtom)

    // Skip if no testset or no trace data
    if (!testsetInfo.id || traceData.length === 0) {
        return {success: false, reason: "missing_data"}
    }

    // Execute auto-mapping (handles its own deduplication via autoMappedTestsetIdAtom)
    const matchedMappings = set(executeAutoMappingAtom)

    return {
        success: true,
        action: "auto_mapped",
        mappings: matchedMappings,
        isNewTestset,
    }
})

/**
 * Write atom: Handle revision selection in one atomic operation
 *
 * This reducer handles the flow when a revision is selected:
 * 1. Reads revision ID from atoms (no params needed except getValueAtPath utility)
 * 2. Validates inputs
 * 3. Delegates to selectRevisionAtom for entity creation
 *
 * Called directly from user action (onCascaderChange), NOT from useEffect.
 * All dependencies are read from atoms.
 *
 * NOTE: This atom imports selectRevisionAtom dynamically to avoid circular deps.
 */
export const onRevisionSelectAtom = atom(
    null,
    (get, set, getValueAtPath: (obj: unknown, path: string) => unknown) => {
        const revisionId = get(selectedRevisionIdAtom)
        const traceData = get(traceDataFromEntitiesAtom)
        const mappingData = get(mappingDataAtom)
        const isNewTestset = get(isNewTestsetAtom)

        // Skip if no revision
        if (!revisionId) {
            return {success: false, reason: "invalid_revision"}
        }

        // For non-new testsets, skip "draft" revision
        if (revisionId === "draft" && !isNewTestset) {
            return {success: false, reason: "invalid_revision"}
        }

        // Skip if no trace data
        if (traceData.length === 0) {
            return {success: false, reason: "no_trace_data"}
        }

        // Check if trace data has loaded (entities have non-empty data)
        // If not loaded yet, log a warning - the data will be synced when entities load
        const hasLoadedData = traceData.some((t) => t.data && Object.keys(t.data).length > 0)
        if (!hasLoadedData) {
            console.warn(
                "[onRevisionSelectAtom] Trace data entities not fully loaded yet. " +
                    "Local entities will have empty data until onNewColumnBlur or mapping change triggers update.",
                {traceDataCount: traceData.length, mappingCount: mappingData.length},
            )
        }

        // Import selectRevisionAtom dynamically to avoid circular dependency
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const {selectRevisionAtom} = require("./localEntities")

        // Delegate to selectRevisionAtom for entity creation
        const result = set(selectRevisionAtom, {
            revisionId,
            traceData,
            mappings: mappingData,
            getValueAtPath,
            isNewTestset,
        })

        return result
    },
)

/**
 * Write atom: Reset auto-mapping state
 * Called when drawer closes or testset/revision changes
 */
export const resetAutoMappingStateAtom = atom(null, (_get, set) => {
    set(autoMappedTestsetIdAtom, null)
})

// ============================================================================
// MAPPING CHANGE REDUCER
// ============================================================================

/**
 * Write atom: Handle mapping option change in one atomic operation
 *
 * This reducer handles:
 * 1. Updates the mapping data at the specified index
 * 2. If not a newColumn change and revision is selected, updates local entities
 *
 * Replaces the nested setMappingData pattern in useTestsetDrawer.
 *
 * Usage:
 *   const onMappingChange = useSetAtom(onMappingChangeAtom)
 *   onMappingChange({ pathName: 'data', value: 'data.inputs', idx: 0 })
 */
export const onMappingChangeAtom = atom(
    null,
    (
        get,
        set,
        params: {
            pathName: keyof Mapping
            value: string
            idx: number
            getValueAtPath: (obj: unknown, path: string) => unknown
        },
    ) => {
        const {pathName, value, idx, getValueAtPath} = params

        // 1. Update mapping data
        const currentMappings = get(mappingDataAtom)
        const newMappings = [...currentMappings]
        newMappings[idx] = {...newMappings[idx], [pathName]: value}
        set(mappingDataAtom, newMappings)

        // 2. Skip entity update for newColumn changes (wait for blur)
        if (pathName === "newColumn") {
            return {success: true, action: "mapping_updated", skipEntityUpdate: true}
        }

        // 3. Update local entities if revision is selected (including "draft" for new testsets)
        const revisionId = get(selectedRevisionIdAtom)
        const isNewTestset = get(isNewTestsetAtom)

        if (revisionId && (revisionId !== "draft" || isNewTestset)) {
            const traceData = get(traceDataFromEntitiesAtom)

            // Import dynamically to avoid circular dependency
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const {updateAllLocalEntitiesAtom} = require("./localEntities")

            set(updateAllLocalEntitiesAtom, {
                traceData,
                mappings: newMappings,
                getValueAtPath,
            })

            return {success: true, action: "mapping_and_entities_updated"}
        }

        return {success: true, action: "mapping_updated"}
    },
)

/**
 * Write atom: Handle new column blur - triggers entity update
 *
 * Called when user finishes typing a new column name.
 * Updates local entities with the current mappings.
 */
export const onNewColumnBlurAtom = atom(
    null,
    (get, set, getValueAtPath: (obj: unknown, path: string) => unknown) => {
        const revisionId = get(selectedRevisionIdAtom)
        const isNewTestset = get(isNewTestsetAtom)

        // Allow "draft" for new testsets
        if (!revisionId || (revisionId === "draft" && !isNewTestset)) {
            return {success: false, reason: "no_revision"}
        }

        const traceData = get(traceDataFromEntitiesAtom)
        const mappings = get(mappingDataAtom)

        // Import dynamically to avoid circular dependency
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const {updateAllLocalEntitiesAtom} = require("./localEntities")

        set(updateAllLocalEntitiesAtom, {
            traceData,
            mappings,
            getValueAtPath,
        })

        return {success: true, action: "entities_updated"}
    },
)
