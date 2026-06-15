/**
 * Query entity — cache invalidation.
 *
 * T1 only needs invalidation (so a live-eval-created query refreshes the
 * registry). The list/detail query atoms land in Phase 2 and will reuse these
 * keys.
 */

import {getDefaultStore} from "jotai"
import {queryClientAtom} from "jotai-tanstack-query"

/** TanStack Query key prefix for the project-scoped SimpleQuery list. */
export const QUERY_LIST_KEY = "queries-list"
/** TanStack Query key prefix for a single query / its revisions. */
export const QUERY_DETAIL_KEY = "query"

/** Invalidate the query list + detail caches after a create/commit/archive. */
export function invalidateQueryCache(): void {
    const store = getDefaultStore()
    const queryClient = store.get(queryClientAtom)
    queryClient.invalidateQueries({queryKey: [QUERY_LIST_KEY]})
    queryClient.invalidateQueries({queryKey: [QUERY_DETAIL_KEY]})
}
