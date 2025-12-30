import {atom} from "jotai"
import {atomFamily} from "jotai/utils"

import type {QueryResult} from "../shared/createStatefulEntityAtomFamily"

import {
    testcaseEntityAtomFamily,
    testcaseQueryAtomFamily,
    type FlattenedTestcase,
} from "./testcaseEntity"

/**
 * Stateful testcase atom family
 *
 * Provides a consistent API for accessing testcase data with explicit loading/error states.
 * This pattern aligns with other entity types (testsets, revisions, variants) for a
 * simplified developer experience.
 *
 * ## Architecture
 *
 * Wraps existing entity logic without replacing it:
 * - Query state (loading/error) from `testcaseQueryAtomFamily`
 * - Entity data (server + draft + column changes) from `testcaseEntityAtomFamily`
 *
 * Returns `QueryResult<FlattenedTestcase>`:
 * ```typescript
 * {
 *   data: FlattenedTestcase | null,
 *   isPending: boolean,
 *   isError: boolean,
 *   error: Error | null
 * }
 * ```
 *
 * ## When to Use
 *
 * **Use this atom when:**
 * - Displaying testcase details in modals/drawers
 * - Components that show loading states
 * - Forms that need to indicate data fetching
 *
 * **Use `testcaseEntityAtomFamily` when:**
 * - Table cells (no loading UI needed, performance critical)
 * - Derived atoms that combine multiple entities
 * - Mutations that need current entity value
 *
 * **Use `testcaseCellAtomFamily` when:**
 * - Table cell components (fine-grained subscriptions)
 * - Only need to re-render when specific cell value changes
 *
 * ## Example Usage
 *
 * ```typescript
 * const TestcaseDetailModal = ({testcaseId}: {testcaseId: string}) => {
 *   const state = useAtomValue(testcaseStatefulAtomFamily(testcaseId))
 *
 *   if (state.isPending) return <Skeleton />
 *   if (state.isError) return <ErrorDisplay error={state.error} />
 *   if (!state.data) return <NotFound />
 *
 *   return <TestcaseView testcase={state.data} />
 * }
 * ```
 *
 * ## Implementation Details
 *
 * This wrapper preserves ALL existing testcase features:
 * - ✅ Batch fetching (concurrent requests combined into single API call)
 * - ✅ Cache redirect (checks paginated query cache before fetching)
 * - ✅ Draft state (local edits merged with server data)
 * - ✅ Column changes (pending renames/adds/deletes applied)
 * - ✅ Cell subscriptions (fine-grained reactivity)
 *
 * Zero breaking changes - all existing components continue working.
 */
export const testcaseStatefulAtomFamily = atomFamily(
    (testcaseId: string) =>
        atom((get): QueryResult<FlattenedTestcase> => {
            // Get query state (loading/error from TanStack Query)
            const queryState = get(testcaseQueryAtomFamily(testcaseId))

            // Get entity state (server + draft + pending column changes)
            const entityData = get(testcaseEntityAtomFamily(testcaseId))

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
