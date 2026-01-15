/**
 * Trace Span Molecule
 *
 * Self-contained molecule for trace span entity state management.
 * Uses the query atoms from store (batch fetching, cache redirect) but manages
 * its own draft state using jotai-family for explicit memory management.
 *
 * This is the PRIMARY API for trace span entities. Use this instead of
 * the legacy controller or individual store atoms.
 *
 * @example
 * ```typescript
 * import { traceSpanMolecule } from '@agenta/entities/trace'
 *
 * // In React components
 * const [state, dispatch] = traceSpanMolecule.useController(spanId)
 *
 * // Fine-grained subscriptions
 * const data = useAtomValue(traceSpanMolecule.atoms.data(spanId))
 * const inputs = useAtomValue(traceSpanMolecule.atoms.inputs(spanId))
 *
 * // Imperative (in callbacks)
 * const spanData = traceSpanMolecule.get.data(spanId)
 * traceSpanMolecule.set.update(spanId, { 'ag.data.inputs': newInputs })
 *
 * // Lifecycle subscriptions (inspired by bunshi patterns)
 * const unsubMount = traceSpanMolecule.lifecycle.onMount((id) => {
 *   console.log(`Span ${id} mounted`)
 * })
 * const unsubUnmount = traceSpanMolecule.lifecycle.onUnmount((id) => {
 *   console.log(`Span ${id} unmounted`)
 * })
 *
 * // Check if span is active in cache
 * const isActive = traceSpanMolecule.lifecycle.isActive(spanId)
 * ```
 */

import {atom} from "jotai"
import {getDefaultStore} from "jotai/vanilla"
import {atomFamily} from "jotai-family"

import {
    createMolecule,
    extendMolecule,
    normalizeValueForComparison,
    createControllerAtomFamily,
    type AtomFamily,
    type StoreOptions,
    type WritableAtomFamily,
} from "../../shared"
import {
    getValueAtPath as getValueAtPathUtil,
    setValueAtPath,
    getItemsAtPath,
    type PathItem,
    type DataPath,
} from "../../ui"
import type {TraceSpan} from "../core"
import {extractAgData, extractInputs, extractOutputs} from "../utils"

import {spanQueryAtomFamily} from "./store"

// ============================================================================
// TYPES
// ============================================================================

/**
 * Type for trace span attributes (the draftable portion)
 */
type TraceSpanAttributes = TraceSpan["attributes"]

// ============================================================================
// DRAFT STATE (SELF-CONTAINED)
// ============================================================================

/**
 * Draft atom family using jotai-family for explicit memory management.
 * Stores local changes to span attributes (the draftable portion).
 *
 * This is self-contained - not wrapping legacy atoms.
 */
const draftAtomFamily = atomFamily((_spanId: string) =>
    atom<TraceSpanAttributes | null>(null),
) as unknown as WritableAtomFamily<TraceSpanAttributes | null, [TraceSpanAttributes | null]>

/**
 * Local data atom family for inline span data (e.g., playground spans that aren't persisted).
 * When set, this data is used instead of fetching from the server.
 */
const localDataAtomFamily = atomFamily((_spanId: string) =>
    atom<TraceSpan | null>(null),
) as unknown as WritableAtomFamily<TraceSpan | null, [TraceSpan | null]>

// ============================================================================
// COMBINED QUERY ATOM (LOCAL + SERVER)
// ============================================================================

/**
 * Combined query atom family that checks local data first, then falls back to server fetch.
 * This allows playground spans (not persisted) to work with the entity system.
 */
const combinedQueryAtomFamily = atomFamily((spanId: string) =>
    atom((get) => {
        // Check local data first (for playground spans)
        const localData = get(localDataAtomFamily(spanId))
        if (localData) {
            return {
                data: localData,
                isPending: false,
                isError: false,
                error: null,
            }
        }

        // Fall back to server query
        return get(spanQueryAtomFamily(spanId))
    }),
)

// ============================================================================
// BASE MOLECULE
// ============================================================================

/**
 * Base trace span molecule using createMolecule factory.
 *
 * Query data flows: combinedQueryAtomFamily (local data OR batched fetch) → molecule
 * Draft data flows: molecule's own draftAtomFamily
 *
 * Lifecycle: Configured to auto-clear drafts on unmount to prevent stale data
 */
const baseMolecule = createMolecule<TraceSpan, TraceSpanAttributes>({
    name: "traceSpan",

    // Combined query atom family - checks local data first, then server
    // This allows playground spans to work without API fetching
    queryAtomFamily: combinedQueryAtomFamily as unknown as AtomFamily<{
        data: TraceSpan | undefined
        isPending: boolean
        isError: boolean
        error: Error | null
    }>,

    // Draft atom family - self-contained local changes storage
    draftAtomFamily,

    // Custom merge: only attributes are draftable
    // Server data + draft attributes → merged entity
    merge: (serverData, draft) => {
        if (!serverData) return null
        if (!draft) return serverData
        return {
            ...serverData,
            attributes: {...serverData.attributes, ...draft},
        }
    },

    // Custom dirty check with deep comparison
    // Uses normalizeValueForComparison for accurate comparison of attributes
    isDirty: (serverData, draft) => {
        if (!draft) return false
        if (!serverData) return draft !== null

        // Deep compare draft attributes against server attributes
        const originalAttrs = serverData.attributes || {}
        const normalizedDraft = normalizeValueForComparison(draft)
        const normalizedOriginal = normalizeValueForComparison(originalAttrs)
        return normalizedDraft !== normalizedOriginal
    },

    // Trace spans are never "new" - they come from the server via tracing
    // But local spans (playground) are considered "new"
    isNewEntity: (id: string) => id.startsWith("inline-") || id.startsWith("local-"),

    // Lifecycle configuration (inspired by bunshi patterns)
    // Auto-clear drafts when span is removed from cache to prevent memory leaks
    lifecycle: {
        clearDraftOnUnmount: true,
        // Optional: Add custom mount/unmount handlers for debugging or analytics
        // onMount: (id) => console.debug(`[traceSpan] mounted: ${id}`),
        // onUnmount: (id) => console.debug(`[traceSpan] unmounted: ${id}`),
    },
})

// ============================================================================
// DERIVED ATOMS (EXTENSIONS)
// ============================================================================

/**
 * Inputs atom family - extracts inputs from span
 * Uses the molecule's merged data atom for consistency
 */
const inputsAtomFamily = atomFamily((spanId: string) =>
    atom((get) => {
        const span = get(baseMolecule.atoms.data(spanId))
        return extractInputs(span)
    }),
)

/**
 * Outputs atom family - extracts outputs from span
 * Uses the molecule's merged data atom for consistency
 */
const outputsAtomFamily = atomFamily((spanId: string) =>
    atom((get) => {
        const span = get(baseMolecule.atoms.data(spanId))
        return extractOutputs(span)
    }),
)

/**
 * AgData atom family - extracts all ag.data from span
 * Uses the molecule's merged data atom for consistency
 */
const agDataAtomFamily = atomFamily((spanId: string) =>
    atom((get) => {
        const span = get(baseMolecule.atoms.data(spanId))
        return extractAgData(span)
    }),
)

// ============================================================================
// HELPER
// ============================================================================

function getStore(options?: StoreOptions) {
    return options?.store ?? getDefaultStore()
}

// ============================================================================
// EXTENDED MOLECULE
// ============================================================================

/**
 * Extended trace span molecule with derived atoms for inputs, outputs, and agData.
 */
const extendedMolecule = extendMolecule(baseMolecule, {
    atoms: {
        /** Extract inputs from span */
        inputs: inputsAtomFamily as AtomFamily<ReturnType<typeof extractInputs>>,
        /** Extract outputs from span */
        outputs: outputsAtomFamily as AtomFamily<ReturnType<typeof extractOutputs>>,
        /** Extract all ag.data from span */
        agData: agDataAtomFamily as AtomFamily<ReturnType<typeof extractAgData>>,
    },
    reducers: {},
    get: {
        inputs: (id: string, options?: StoreOptions) => getStore(options).get(inputsAtomFamily(id)),
        outputs: (id: string, options?: StoreOptions) =>
            getStore(options).get(outputsAtomFamily(id)),
        agData: (id: string, options?: StoreOptions) => getStore(options).get(agDataAtomFamily(id)),
    },
    set: {},
})

// ============================================================================
// DRILL-IN PATH HELPERS
// ============================================================================

/**
 * Detect the path to ag.data within a span's attributes.
 * Handles both formats:
 * - span.attributes["ag.data"] (flat key with literal dot)
 * - span.attributes.ag.data (nested structure)
 */
function getAgDataPath(span: TraceSpan | null): DataPath {
    if (!span?.attributes) return ["attributes"]

    const attrs = span.attributes as Record<string, unknown>

    // Check for flat key format first (literal "ag.data" key)
    if ("ag.data" in attrs) {
        return ["attributes", "ag.data"]
    }

    // Check for nested format
    if (attrs.ag && typeof attrs.ag === "object") {
        return ["attributes", "ag", "data"]
    }

    // Default to attributes root if no ag.data found
    return ["attributes"]
}

/**
 * Get value at path from the full span.
 */
function getValueAtPath(data: TraceSpan | null, path: DataPath): unknown {
    if (!data) return undefined
    return getValueAtPathUtil(data, path)
}

/**
 * Get root items for navigation.
 */
function getRootItems(data: TraceSpan | null, _columns?: unknown): PathItem[] {
    if (!data) return []
    return getItemsAtPath(data, [])
}

/**
 * Convert a change at a path back to span attribute changes.
 */
function getChangesFromPath(
    span: TraceSpan | null,
    path: DataPath,
    value: unknown,
): TraceSpan["attributes"] | null {
    if (!span || path.length === 0) return null

    if (path[0] !== "attributes") {
        console.warn("[traceSpanMolecule] Only attribute changes are supported, got path:", path)
        return null
    }

    const updated = setValueAtPath(span, path, value)
    return (updated as TraceSpan).attributes
}

// ============================================================================
// CONTROLLER ATOM FAMILY (for EntityDrillInView compatibility)
// ============================================================================

/**
 * Controller atom family - provides state + dispatch for EntityDrillInView.
 * Uses the shared createControllerAtomFamily factory.
 */
const controllerAtomFamily = createControllerAtomFamily<TraceSpan, TraceSpanAttributes>({
    dataAtom: extendedMolecule.atoms.data,
    isDirtyAtom: extendedMolecule.atoms.isDirty,
    queryAtom: extendedMolecule.atoms.query,
    updateReducer: extendedMolecule.reducers.update,
    discardReducer: extendedMolecule.reducers.discard,
    drillIn: {
        getChangesFromPath,
    },
})

// ============================================================================
// FINAL MOLECULE EXPORT
// ============================================================================

/**
 * Trace span molecule - unified API for trace span entities.
 *
 * This is the PRIMARY API for trace span entities. Provides:
 * - atoms.* - Fine-grained atom families
 * - selectors.* - Alias for atoms (EntityDrillInView compatibility)
 * - controller(id) - State + dispatch atom (EntityDrillInView compatibility)
 * - reducers.* - Write atoms for mutations
 * - drillIn.* - Path navigation utilities
 * - get.* / set.* - Imperative API for callbacks
 * - useController(id) - React hook returning [state, dispatch]
 *
 * @example
 * ```typescript
 * import { traceSpanMolecule } from '@agenta/entities/trace'
 *
 * // For EntityDrillInView
 * <EntityDrillInView entityId={spanId} entity={traceSpanMolecule} />
 *
 * // Fine-grained subscriptions
 * const data = useAtomValue(traceSpanMolecule.atoms.data(spanId))
 * const inputs = useAtomValue(traceSpanMolecule.atoms.inputs(spanId))
 *
 * // Controller pattern
 * const [state, dispatch] = useAtom(traceSpanMolecule.controller(spanId))
 * ```
 */
export const traceSpanMolecule = {
    ...extendedMolecule,

    /**
     * Controller atom family for EntityDrillInView compatibility
     */
    controller: controllerAtomFamily,

    /**
     * Selectors (alias to atoms for EntityDrillInView compatibility)
     */
    selectors: {
        data: extendedMolecule.atoms.data,
        serverData: extendedMolecule.atoms.serverData,
        isDirty: extendedMolecule.atoms.isDirty,
        query: extendedMolecule.atoms.query,
        inputs: extendedMolecule.atoms.inputs,
        outputs: extendedMolecule.atoms.outputs,
        agData: extendedMolecule.atoms.agData,
    },

    /**
     * DrillIn utilities for path navigation
     */
    drillIn: {
        getValueAtPath,
        getRootItems,
        getChangesFromPath,
        valueMode: "structured" as const,
        /**
         * Extract root data for navigation.
         * For trace spans, navigate into the attributes.
         */
        getRootData: (span: TraceSpan | null) => span?.attributes ?? null,
        /**
         * Convert path-based changes back to attribute draft format.
         * Delegates to getChangesFromPath which handles the path normalization.
         */
        getChangesFromRoot: (
            span: TraceSpan | null,
            _rootData: unknown,
            path: DataPath,
            value: unknown,
        ): TraceSpanAttributes | null => {
            // For getRootData returning attributes, path is relative to attributes
            // But getChangesFromPath expects full path starting with "attributes"
            const fullPath: DataPath = ["attributes", ...path]
            return getChangesFromPath(span, fullPath, value)
        },
    },

    /**
     * Get the path to ag.data within the span
     */
    getAgDataPath,

    /**
     * Local data management for inline spans (playground spans that aren't persisted)
     */
    local: {
        /**
         * Set local span data (for playground spans)
         * This data will be used instead of fetching from the server.
         */
        set: (spanId: string, data: TraceSpan, options?: StoreOptions) => {
            getStore(options).set(localDataAtomFamily(spanId), data)
        },

        /**
         * Clear local span data
         */
        clear: (spanId: string, options?: StoreOptions) => {
            getStore(options).set(localDataAtomFamily(spanId), null)
        },

        /**
         * Clear all local span data for multiple spans
         */
        clearAll: (spanIds: string[], options?: StoreOptions) => {
            const store = getStore(options)
            spanIds.forEach((id) => store.set(localDataAtomFamily(id), null))
        },

        /**
         * Atom family for local data (for reactive reads)
         */
        dataAtom: localDataAtomFamily,
    },
}

// ============================================================================
// TYPE EXPORTS
// ============================================================================

export type TraceSpanMolecule = typeof traceSpanMolecule
