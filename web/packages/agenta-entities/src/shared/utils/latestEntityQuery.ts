/**
 * Latest Entity Query Factory
 *
 * Creates a set of atoms for fetching the "latest" version of an entity.
 * This pattern is useful when you need to fetch only the most recent item
 * from a collection (e.g., latest revision, latest config) without fetching
 * the entire list.
 *
 * ## Usage
 *
 * ```typescript
 * import { createLatestEntityQueryFactory } from '@agenta/entities/shared'
 *
 * // Create the factory for your entity type
 * const latestRevisionQuery = createLatestEntityQueryFactory<Revision>({
 *   queryKeyPrefix: 'latest-revision',
 *   fetchFn: (testsetId, projectId) => fetchLatestRevision({ testsetId, projectId }),
 *   staleTime: 30_000,
 * })
 *
 * // Use in components
 * const requestLatest = useSetAtom(latestRevisionQuery.requestAtom)
 * requestLatest({ parentId: testsetId, projectId })
 *
 * const { data, isPending } = useAtomValue(latestRevisionQuery.statefulAtomFamily(testsetId))
 * ```
 *
 * ## Why this pattern?
 *
 * 1. **Optimized fetching**: Fetches only 1 item instead of the full list
 * 2. **Explicit enabling**: Queries are disabled until explicitly requested
 * 3. **Project context**: Stores projectId per parent entity to avoid global state timing issues
 * 4. **Reusable**: Same pattern can be applied to any entity with a "latest" concept
 */

import {atom} from "jotai"
import {atomFamily} from "jotai-family"
import {atomWithQuery} from "jotai-tanstack-query"

// ============================================================================
// TYPES
// ============================================================================

/**
 * Configuration for creating a latest entity query factory
 */
export interface CreateLatestEntityQueryConfig<TResult> {
    /**
     * Unique prefix for query keys (e.g., "latest-revision", "latest-evaluator-config")
     * This should be unique across all latest entity queries to avoid cache collisions
     */
    queryKeyPrefix: string

    /**
     * Function to fetch the latest entity
     * @param parentId - The ID of the parent entity (e.g., testsetId for revisions)
     * @param projectId - The project ID for scoping
     * @returns The latest entity or null if not found
     */
    fetchFn: (parentId: string, projectId: string) => Promise<TResult | null>

    /**
     * How long the query result should be considered fresh (in ms)
     * @default 30_000 (30 seconds)
     */
    staleTime?: number
}

/**
 * Parameters for enabling/requesting a latest entity query
 */
export interface LatestEntityQueryParams {
    parentId: string
    projectId: string
}

// Note: We use simplified types here to avoid complex Jotai type gymnastics.
// The actual return types are more specific but TypeScript struggles with
// ReturnType<typeof atomFamily<...>> patterns. Runtime behavior is correct.

// ============================================================================
// FACTORY
// ============================================================================

/**
 * Creates a factory for fetching the "latest" version of an entity
 *
 * This factory creates a set of Jotai atoms that handle:
 * - Project ID storage per parent entity
 * - Request tracking (queries only run when explicitly requested)
 * - TanStack Query integration for caching
 * - Loading state management
 *
 * @template TResult - The type of entity being fetched
 * @param config - Configuration for the factory
 * @returns An object containing atoms and action atoms for the latest entity query
 *
 * @example
 * // For testset revisions
 * const latestRevisionQuery = createLatestEntityQueryFactory<Revision>({
 *   queryKeyPrefix: 'latest-revision',
 *   fetchFn: fetchLatestRevision,
 * })
 *
 * // For evaluator configs
 * const latestEvaluatorQuery = createLatestEntityQueryFactory<EvaluatorConfig>({
 *   queryKeyPrefix: 'latest-evaluator',
 *   fetchFn: fetchLatestEvaluatorConfig,
 * })
 */
export function createLatestEntityQueryFactory<TResult>(
    config: CreateLatestEntityQueryConfig<TResult>,
) {
    const {queryKeyPrefix, fetchFn, staleTime = 30_000} = config

    // ========================================================================
    // PRIVATE ATOMS
    // ========================================================================

    /**
     * Store projectId per parent entity
     * This avoids relying on a global projectIdAtom that may not be synced
     */
    const projectIdMapAtom = atom<Map<string, string>>(new Map())

    /**
     * Track which parent entities have had queries requested
     */
    const requestedAtom = atom<Set<string>>(new Set<string>())

    // ========================================================================
    // PUBLIC ATOMS
    // ========================================================================

    /**
     * Enable queries for a parent entity with its projectId
     */
    const enableQueryAtom = atom(
        null,
        (get, set, params: {parentId: string; projectId: string}) => {
            const {parentId, projectId} = params

            // Store the projectId for this parent
            const projectIdMap = new Map(get(projectIdMapAtom))
            projectIdMap.set(parentId, projectId)
            set(projectIdMapAtom, projectIdMap)

            // Mark as requested
            const requested = new Set(get(requestedAtom))
            requested.add(parentId)
            set(requestedAtom, requested)
        },
    )

    /**
     * Query atom family for fetching the latest entity
     */
    const queryAtomFamily = atomFamily((parentId: string) =>
        atomWithQuery<TResult | null>((get) => {
            const projectIdMap = get(projectIdMapAtom)
            const projectId = projectIdMap.get(parentId) ?? null
            const requested = get(requestedAtom)
            const isRequested = requested.has(parentId)
            const isEnabled = Boolean(projectId && parentId && isRequested)

            return {
                queryKey: [queryKeyPrefix, projectId, parentId],
                queryFn: async () => {
                    if (!projectId || !parentId) return null
                    return fetchFn(parentId, projectId)
                },
                enabled: isEnabled,
                staleTime,
            }
        }),
    )

    /**
     * Stateful atom family with simplified loading state
     */
    const statefulAtomFamily = atomFamily((parentId: string) =>
        atom((get) => {
            const query = get(queryAtomFamily(parentId))
            return {
                data: query.data ?? null,
                isPending: query.isPending,
            }
        }),
    )

    /**
     * Action atom to request the latest entity
     */
    const requestAtom = atom<null, [{parentId: string; projectId: string}], void>(
        null,
        (_get, set, params) => {
            if (!params.parentId || !params.projectId) return
            set(enableQueryAtom, params)
        },
    )

    return {
        enableQueryAtom,
        queryAtomFamily,
        statefulAtomFamily,
        requestAtom,
    }
}
