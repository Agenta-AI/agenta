/**
 * Entity Query Invalidation
 *
 * Shared utility for invalidating TanStack Query caches for legacyAppRevision
 * entity queries. Used by all CRUD actions (commit, create, delete) to ensure
 * entity-level queries are refreshed after mutations.
 *
 * This handles entity-package-level invalidation only. Playground-specific
 * or OSS-specific query keys are handled via registered callbacks.
 */

import {queryClient} from "@agenta/shared/api"
import {getDefaultStore} from "jotai"

import {revisionCacheVersionAtom} from "./store"

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
 * 1. Invalidates TanStack Query caches (marks as stale)
 * 2. Refetches all matching queries
 * 3. Bumps the revision cache version so cache-derived atoms re-evaluate
 *
 * Playground-specific or OSS-specific query invalidation should be handled
 * separately via registered callbacks.
 */
export async function invalidateEntityQueries(): Promise<void> {
    // Invalidate to mark as stale
    await Promise.all(
        ENTITY_QUERY_KEYS.map((queryKey) =>
            queryClient.invalidateQueries({queryKey, exact: false}),
        ),
    )

    // Refetch with type: 'all' to bypass cache
    await Promise.all(
        ENTITY_QUERY_KEYS.map((queryKey) =>
            queryClient.refetchQueries({queryKey, type: "all", exact: false}),
        ),
    )

    // Bump the revision cache version so cache-derived atoms re-evaluate
    const store = getDefaultStore()
    store.set(revisionCacheVersionAtom, (prev: number) => prev + 1)
}
