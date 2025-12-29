import type {PathItem} from "@/oss/components/DrillInView"

import {
    createEntityDraftState,
    normalizeValueForComparison,
} from "../shared/createEntityDraftState"
import {createDrillInState} from "../shared/createDrillInState"

import {traceSpanAtomFamily} from "./store"
import type {TraceSpan} from "./schema"

// ============================================================================
// TYPES
// ============================================================================

/**
 * Type for trace span attributes (the draftable portion)
 */
type TraceSpanAttributes = TraceSpan["attributes"]

// ============================================================================
// DRAFT STATE (For editing trace spans in AddToTestset drawer)
// Uses shared factory with trace-specific configuration
// ============================================================================

/**
 * Create draft state management for trace spans
 * Uses shared factory with trace-specific configuration
 */
const traceSpanDraftState = createEntityDraftState<TraceSpan, TraceSpanAttributes>({
    // Read from trace span entity atoms
    entityAtomFamily: traceSpanAtomFamily,

    // Only attributes are draftable (rest of span metadata is read-only)
    getDraftableData: (span) => span.attributes || {},

    // Merge draft attributes back into span
    mergeDraft: (span, draftAttrs) => ({
        ...span,
        attributes: {...span.attributes, ...draftAttrs},
    }),

    // Custom dirty detection: compare normalized attributes
    isDirty: (currentAttrs, originalAttrs) => {
        const normalizedCurrent = normalizeValueForComparison(currentAttrs)
        const normalizedOriginal = normalizeValueForComparison(originalAttrs)
        return normalizedCurrent !== normalizedOriginal
    },
})

// Export atoms with original names for backward compatibility
export const traceSpanDraftAtomFamily = traceSpanDraftState.draftAtomFamily
export const traceSpanWithDraftAtomFamily = traceSpanDraftState.withDraftAtomFamily
export const traceSpanHasDraftAtomFamily = traceSpanDraftState.hasDraftAtomFamily
export const traceSpanIsDirtyAtomFamily = traceSpanDraftState.isDirtyAtomFamily
export const discardTraceSpanDraftAtom = traceSpanDraftState.discardDraftAtom

/**
 * Update a trace span (creates draft)
 * Note: This updates the entire span (backward compat), but factory only drafts attributes
 */
export const updateTraceSpanAtom = traceSpanDraftState.updateAtom

// ============================================================================
// DRILL-IN STATE (Path-based navigation and editing)
// Uses shared factory with trace-specific configuration
// ============================================================================

/**
 * Create drill-in state management for trace spans
 * Uses shared factory with attributes-based structure and native value mode
 */
const traceSpanDrillIn = createDrillInState<TraceSpan, TraceSpanAttributes>({
    // Only attributes are navigable (rest of span is metadata)
    getRootData: (span) => span.attributes || {},

    // Generate root items from attribute keys
    getRootItems: (span) => {
        if (!span || !span.attributes) return []

        const attributes = span.attributes as Record<string, unknown>

        return Object.keys(attributes)
            .sort()
            .map((key) => ({
                key,
                name: key,
                value: attributes[key],
                isColumn: false,
            }))
    },

    // Use trace span update atom for mutations
    updateAtom: updateTraceSpanAtom,

    // Set updated attributes back to span
    // For traces, extract only the top-level attribute that changed
    setRootData: (_span, attrs, path) => {
        if (path.length === 0) return attrs as any
        // Extract only the top-level attribute that changed
        const topLevelKey = path[0]
        return {
            [topLevelKey]: (attrs as Record<string, unknown>)[topLevelKey],
        } as any
    },

    // Native mode - values are kept as-is (not serialized to strings)
    valueMode: "native",

    // Entity atom family (includes draft state)
    entityAtomFamily: traceSpanWithDraftAtomFamily,
})

// Export read helpers with original names
export const getTraceSpanValueAtPath = traceSpanDrillIn.getValueAtPath
export const getTraceSpanRootItems = traceSpanDrillIn.getRootItems

// Export write atom with original name
export const traceSpanSetValueAtPathAtom = traceSpanDrillIn.setValueAtPathAtom

// Export UI state atoms (if needed in the future - not currently used for trace)
// export const traceSpanDrillInCurrentPathAtomFamily = traceSpanDrillIn.currentPathAtomFamily
// export const traceSpanDrillInCollapsedFieldsAtomFamily = traceSpanDrillIn.collapsedFieldsAtomFamily
// export const traceSpanDrillInRawModeFieldsAtomFamily = traceSpanDrillIn.rawModeFieldsAtomFamily
