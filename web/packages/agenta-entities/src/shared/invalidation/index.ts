/**
 * Entity Query Invalidation
 *
 * Cross-cutting utility for invalidating TanStack Query caches for
 * entity-level queries. Used by CRUD actions and bridge callbacks
 * to ensure entity-level queries are refreshed after mutations.
 *
 * This handles entity-package-level invalidation only. Domain-specific
 * query keys (workflow list, variant list, revision list) are handled
 * by their respective packages.
 */

import {queryClient} from "@agenta/shared/api"

// ============================================================================
// ENTITY QUERY KEYS
// ============================================================================

/**
 * TanStack Query keys used by the entity package's atomWithQuery atoms.
 * These are the canonical keys for variant and revision list queries.
 */
const ENTITY_QUERY_KEYS = [
    ["oss-variants-for-selection"],
    ["oss-revisions-for-selection"],
    ["latest-server-revision-id"],
]

// ============================================================================
// INVALIDATION
// ============================================================================

/**
 * Invalidate and refetch all entity-level variant/revision queries.
 *
 * This is the entity-package-level invalidation that should be called
 * after any CRUD mutation. It:
 * 1. Removes TanStack Query caches (forces fresh fetch on remount)
 * 2. Invalidates actively mounted queries (triggers immediate refetch)
 *
 * Callers that need additional side-effects (e.g. bumping a cache version
 * atom) should perform those after calling this function.
 *
 * Domain-specific query invalidation (workflow list, variants, revisions)
 * should be handled separately by the respective entity packages.
 */
export async function invalidateEntityQueries(): Promise<void> {
    // Remove queries from TanStack cache entirely.
    // This is critical for cross-page invalidation: when a mutation happens
    // on one page (e.g. playground), queries used by another page (e.g. registry)
    // may not be actively mounted. `invalidateQueries` is a no-op for unmounted
    // queries. `removeQueries` destroys the cached data so that when the query's
    // observer re-evaluates on navigation, it finds no data and triggers a fresh fetch.
    ENTITY_QUERY_KEYS.forEach((queryKey) => {
        queryClient.removeQueries({queryKey, exact: false})
    })

    // Also invalidate any that ARE currently mounted — this triggers an
    // immediate refetch for active observers (e.g. if we're on the registry page).
    await Promise.all(
        ENTITY_QUERY_KEYS.map((queryKey) =>
            queryClient.invalidateQueries({queryKey, exact: false}),
        ),
    )
}
