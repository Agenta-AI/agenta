/**
 * Trace Entity API
 *
 * Provides a unified, simplified API for working with trace span entities.
 * Abstracts away the complexity of multiple atoms into a single cohesive interface.
 *
 * ## Usage
 *
 * ```typescript
 * import { traceSpan } from '@/state/entities/trace'
 *
 * // Option 1: Full controller (state + dispatch)
 * function SpanEditor({ spanId }: { spanId: string }) {
 *   const [span, dispatch] = useAtom(traceSpan.controller(spanId))
 *
 *   if (span.isPending) return <Skeleton />
 *   if (span.isError) return <ErrorDisplay error={span.error} />
 *   if (!span.data) return <NotFound />
 *
 *   return (
 *     <div>
 *       <Editor
 *         value={span.data.attributes}
 *         onChange={(attrs) => dispatch({ type: 'update', changes: attrs })}
 *       />
 *       {span.isDirty && (
 *         <Button onClick={() => dispatch({ type: 'discard' })}>
 *           Discard Changes
 *         </Button>
 *       )}
 *     </div>
 *   )
 * }
 *
 * // Option 2: Efficient selectors (only subscribe to what you need)
 * function DirtyIndicator({ spanId }: { spanId: string }) {
 *   const isDirty = useAtomValue(traceSpan.selectors.isDirty(spanId))
 *   return isDirty ? <Badge>Modified</Badge> : null
 * }
 *
 * // Option 3: In-atom usage (for derived atoms)
 * const myDerivedAtom = atom(null, (get, set) => {
 *   set(traceSpan.actions.update, spanId, { 'ag.data.inputs': newInputs })
 *   set(traceSpan.actions.discard, spanId)
 * })
 * ```
 *
 * ## API Structure
 *
 * ```typescript
 * traceSpan.controller(id)     // Full state + dispatch (useAtom)
 * traceSpan.selectors.data(id)       // Entity with draft merged
 * traceSpan.selectors.serverData(id) // Raw server data
 * traceSpan.selectors.isDirty(id)    // Has unsaved changes
 * traceSpan.selectors.stateful(id)   // Data + loading/error states
 * traceSpan.actions.update           // Update atom: set(actions.update, id, changes)
 * traceSpan.actions.discard          // Discard atom: set(actions.discard, id)
 * ```
 *
 * ## When to Use Each
 *
 * **Use `controller` when:**
 * - You need both state and actions together
 * - Building forms or editors
 * - You want the simplest API
 *
 * **Use `selectors` when:**
 * - You only need one piece of state (e.g., just isDirty)
 * - Performance-critical scenarios (avoid extra subscriptions)
 * - Building derived atoms
 *
 * **Use `actions` when:**
 * - Dispatching from other atoms (inside `set()`)
 * - Building derived write atoms
 */

import {createEntityController, type PathItem} from "../shared/createEntityController"
import type {TraceSpan} from "./schema"
import {
    discardTraceSpanDraftAtom,
    spanQueryAtomFamily,
    traceSpanEntityAtomFamily,
    traceSpanIsDirtyAtomFamily,
    updateTraceSpanAtom,
} from "./store"

/**
 * Type for trace span attributes (the draftable portion)
 */
type TraceSpanAttributes = TraceSpan["attributes"]

/**
 * Trace span entity API
 *
 * Provides controller, selectors, and actions for trace span entities.
 *
 * @example
 * ```typescript
 * // Full controller in components
 * const [span, dispatch] = useAtom(traceSpan.controller(spanId))
 * dispatch({ type: 'update', changes: { 'ag.data.inputs': newInputs } })
 *
 * // Efficient selectors
 * const isDirty = useAtomValue(traceSpan.selectors.isDirty(spanId))
 * const data = useAtomValue(traceSpan.selectors.data(spanId))
 *
 * // In other atoms
 * set(traceSpan.actions.update, spanId, newAttributes)
 * set(traceSpan.actions.discard, spanId)
 * ```
 */
export const traceSpan = createEntityController<TraceSpan, TraceSpan["attributes"]>({
    name: "traceSpan",

    // Entity data (server + draft merged)
    dataAtomFamily: traceSpanEntityAtomFamily,

    // Query atom - single source of truth for server data
    queryAtomFamily: spanQueryAtomFamily,

    // Dirty state
    isDirtyAtomFamily: traceSpanIsDirtyAtomFamily,

    // Actions
    updateAtom: updateTraceSpanAtom,
    discardAtom: discardTraceSpanDraftAtom,

    // Trace spans are never "new" - they come from the server via tracing
    isNewEntity: () => false,

    // Drill-in capability for path-based navigation and editing
    drillIn: {
        // Only attributes are navigable (rest of span is metadata)
        getRootData: (span) => (span.attributes || {}) as TraceSpanAttributes,

        // Convert updated attributes back to entity update
        // For traces, extract only the top-level attribute that changed
        setRootData: (_span, attrs, path): Partial<TraceSpan> => {
            if (path.length === 0) return attrs as unknown as Partial<TraceSpan>
            const topLevelKey = path[0]
            return {
                [topLevelKey]: (attrs as Record<string, unknown>)[topLevelKey],
            } as unknown as Partial<TraceSpan>
        },

        // Generate root items from attribute keys
        getRootItems: (span: TraceSpan | null): PathItem[] => {
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

        // Native mode - values are kept as-is (not serialized to strings)
        valueMode: "native",
    },
})

// Re-export types for convenience
export type {EntityAction, EntityControllerState} from "../shared/createEntityController"
