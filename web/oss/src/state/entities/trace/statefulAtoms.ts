import {atom} from "jotai"
import {atomFamily} from "jotai/utils"

import type {QueryResult} from "../shared/createStatefulEntityAtomFamily"

import type {TraceSpan} from "./schema"
import {spanQueryAtomFamily, traceSpanEntityAtomFamily} from "./store"

/**
 * Stateful trace span atom family
 *
 * Provides a consistent API for accessing trace span data with explicit loading/error states.
 * This pattern aligns with other entity types (testcases, testsets, revisions) for a
 * simplified developer experience.
 *
 * ## Architecture
 *
 * Wraps existing entity logic without replacing it:
 * - Query state (loading/error) from `spanQueryAtomFamily`
 * - Entity data (server + draft) from `traceSpanEntityAtomFamily`
 *
 * Returns `QueryResult<TraceSpan>`:
 * ```typescript
 * {
 *   data: TraceSpan | null,
 *   isPending: boolean,
 *   isError: boolean,
 *   error: Error | null
 * }
 * ```
 *
 * ## When to Use
 *
 * **Use this atom when:**
 * - Displaying span details in modals/drawers
 * - Components that show loading states
 * - Forms that need to indicate data fetching
 *
 * **Use `traceSpanEntityAtomFamily` when:**
 * - Drill-in views that need draft state
 * - Components that edit span data
 * - When loading state is handled elsewhere
 *
 * **Use `traceSpanServerStateAtomFamily` when:**
 * - Need raw server data without draft merging
 * - Dirty comparison (current vs original)
 * - Derived atoms that need original server values
 *
 * ## Example Usage
 *
 * ```typescript
 * const SpanDetailDrawer = ({spanId}: {spanId: string}) => {
 *   const state = useAtomValue(traceSpanStatefulAtomFamily(spanId))
 *
 *   if (state.isPending) return <Skeleton />
 *   if (state.isError) return <ErrorDisplay error={state.error} />
 *   if (!state.data) return <NotFound />
 *
 *   return <SpanView span={state.data} />
 * }
 * ```
 *
 * ## Implementation Details
 *
 * This wrapper preserves ALL existing trace span features:
 * - ✅ Batch fetching (concurrent requests combined into single API call)
 * - ✅ Cache redirect (checks list query cache before fetching)
 * - ✅ Draft state (local edits merged with server data)
 * - ✅ Drill-in navigation and editing
 *
 * Zero breaking changes - all existing components continue working.
 */
export const traceSpanStatefulAtomFamily = atomFamily(
    (spanId: string) =>
        atom((get): QueryResult<TraceSpan> => {
            // Get query state (loading/error from TanStack Query)
            const queryState = get(spanQueryAtomFamily(spanId))

            // Get entity state (server + draft if exists)
            const entityData = get(traceSpanEntityAtomFamily(spanId))

            return {
                data: entityData,
                isPending: queryState.isPending,
                isError: queryState.isError,
                error: queryState.error,
            }
        }),
    // Comparison function for atomFamily deduplication
    (a, b) => a === b,
)
