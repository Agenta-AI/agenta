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
    // Freshness (gates not-found retries to just-finished runs)
    markTraceAsFresh,
    // Error classes
    SpanNotFoundError,
    TraceNotFoundError,
    // Trace-level query atom
    traceEntityAtomFamily,
    // Lightweight summary query (root span + errored spans, flat)
    traceSummaryQueryAtomFamily,
    type TraceSummarySpans,
    // Trace-level derived atoms (convenience selectors)
    traceRootSpanAtomFamily,
    traceInputsAtomFamily,
    traceOutputsAtomFamily,
    // Span query atom (used internally by molecule)
    spanQueryAtomFamily,
} from "./store"

// ============================================================================
// PREFETCH (cache-aware bulk)
// ============================================================================

export {
    prefetchTracesByIds,
    invalidateTrace,
    type PrefetchTracesArgs,
    type PrefetchTracesOutcome,
} from "./prefetch"
