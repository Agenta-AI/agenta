/**
 * State Management Layer
 *
 * Exports molecule and store atoms for trace/span state management.
 */

// ============================================================================
// MOLECULE (PRIMARY API)
// ============================================================================

export {traceSpanMolecule, type TraceSpanMolecule} from "./molecule"

// ============================================================================
// STORE ATOMS
// ============================================================================

export {
    // Cache invalidation
    invalidateTraceEntityCache,
    // Error classes
    SpanNotFoundError,
    TraceNotFoundError,
    // Trace-level query atom
    traceEntityAtomFamily,
    // Span query atom (used internally by molecule)
    spanQueryAtomFamily,
} from "./store"
