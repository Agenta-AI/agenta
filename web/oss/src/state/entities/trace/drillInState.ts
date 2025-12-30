import type {PathItem} from "@/oss/components/DrillInView"

import {createDrillInState} from "../shared/createDrillInState"

import type {TraceSpan} from "./schema"
import {
    traceSpanEntityAtomFamily,
    updateTraceSpanAtom,
} from "./store"

// ============================================================================
// RE-EXPORTS FROM STORE (for backward compatibility)
// Draft state is now defined in store.ts for consistency with other entities
// ============================================================================

export {
    // Draft atoms
    traceSpanDraftAtomFamily,
    traceSpanHasDraftAtomFamily,
    traceSpanIsDirtyAtomFamily,
    discardTraceSpanDraftAtom,
    updateTraceSpanAtom,
    // Entity atom (combined server + draft)
    traceSpanEntityAtomFamily,
} from "./store"

// Backward compatibility alias
// traceSpanWithDraftAtomFamily was the old name for the combined entity atom
export {traceSpanEntityAtomFamily as traceSpanWithDraftAtomFamily} from "./store"

// ============================================================================
// TYPES
// ============================================================================

/**
 * Type for trace span attributes (the draftable portion)
 */
type TraceSpanAttributes = TraceSpan["attributes"]

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
    entityAtomFamily: traceSpanEntityAtomFamily,
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
