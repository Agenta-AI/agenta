import {atom} from "jotai"
import type {Atom, Getter} from "jotai"
import {atomFamily} from "jotai/utils"

/**
 * Query result type matching React Query structure
 */
export interface QueryResult<T> {
    data: T | null
    isPending: boolean
    isError: boolean
    error: Error | null
}

/**
 * Configuration for creating a stateful entity atom family
 */
export interface StatefulEntityConfig<TEntity, TDetailParams extends {id: string}, TQueryResult> {
    /**
     * Base entity atom family (cache layer)
     * Example: testsetStore.entityAtomFamily
     */
    entityAtomFamily: (id: string) => Atom<TEntity | null>

    /**
     * Detail query atom that fetches and hydrates the entity
     * Example: testsetStore.detailQueryAtom
     */
    detailQueryAtom: (params: TDetailParams) => Atom<QueryResult<TQueryResult>>

    /**
     * Function to derive query parameters from context
     * Should return null if required context is not available
     * Example: (get, id) => {
     *   const projectId = get(projectIdAtom)
     *   return projectId ? {id, projectId} : null
     * }
     */
    getQueryParams: (get: Getter, id: string) => TDetailParams | null

    /**
     * Optional function to extract entity from query result
     * Use when query result shape differs from entity shape
     * Example: (result) => result.data
     */
    extractEntity?: (queryResult: TQueryResult) => TEntity
}

/**
 * Creates a "stateful" entity atom family that combines:
 * - Entity storage (cache layer)
 * - Query atoms (server state)
 *
 * The resulting atom family provides:
 * - Fast reads from cache when entity is already loaded
 * - Automatic query triggering when entity is not in cache
 * - Loading and error states
 * - Automatic cache hydration
 *
 * This pattern reduces boilerplate by eliminating the need to:
 * 1. Check if entity exists in cache
 * 2. Manually trigger query atom
 * 3. Handle loading/error states separately
 *
 * @example
 * ```typescript
 * // Create stateful atom family
 * export const testsetStatefulAtomFamily = createStatefulEntityAtomFamily({
 *   entityAtomFamily: testsetStore.entityAtomFamily,
 *   detailQueryAtom: testsetStore.detailQueryAtom,
 *   getQueryParams: (get, id) => {
 *     const projectId = get(projectIdAtom)
 *     return projectId ? {id, projectId} : null
 *   }
 * })
 *
 * // Use in component
 * function TestsetViewer({testsetId}: {testsetId: string}) {
 *   const testsetState = useAtomValue(testsetStatefulAtomFamily(testsetId))
 *
 *   if (testsetState.isPending) return <Loading />
 *   if (testsetState.isError) return <Error error={testsetState.error} />
 *   if (!testsetState.data) return <NotFound />
 *
 *   return <div>{testsetState.data.name}</div>
 * }
 * ```
 *
 * Benefits:
 * - Single atom subscription instead of separate entity + query subscriptions
 * - Automatic query triggering when needed
 * - Cache-first reads (fast)
 * - Full React Query benefits (loading, error, refetch, etc.)
 * - Type-safe
 *
 * Trade-offs:
 * - Slightly more complex than pure entity atoms
 * - Requires context atoms to be available (e.g., projectIdAtom)
 * - Query is triggered on every read if entity not in cache (by design)
 */
export function createStatefulEntityAtomFamily<
    TEntity,
    TDetailParams extends {id: string},
    TQueryResult = TEntity,
>(
    config: StatefulEntityConfig<TEntity, TDetailParams, TQueryResult>,
): (id: string) => Atom<QueryResult<TEntity>> {
    return atomFamily(
        (id: string) =>
            atom((get): QueryResult<TEntity> => {
                // STEP 1: Check entity cache first (fast path)
                const cachedEntity = get(config.entityAtomFamily(id))

                if (cachedEntity) {
                    // Entity is in cache - return immediately with success state
                    return {
                        data: cachedEntity,
                        isPending: false,
                        isError: false,
                        error: null,
                    }
                }

                // STEP 2: Entity not in cache - try to fetch it
                // Get query parameters from context
                const params = config.getQueryParams(get, id)

                if (!params) {
                    // Required context not available (e.g., projectId not set)
                    // Return null state without triggering query
                    return {
                        data: null,
                        isPending: false,
                        isError: false,
                        error: null,
                    }
                }

                // STEP 3: Trigger query to fetch and hydrate entity
                // The query atom will:
                // 1. Fetch from server
                // 2. Hydrate entity cache (via onSuccess)
                // 3. Return query state
                const queryResult = get(config.detailQueryAtom(params))

                // Extract entity from query result if needed
                let entityData: TEntity | null = null
                if (queryResult.data) {
                    entityData = config.extractEntity
                        ? config.extractEntity(queryResult.data)
                        : (queryResult.data as unknown as TEntity)
                }

                return {
                    data: entityData,
                    isPending: queryResult.isPending,
                    isError: queryResult.isError,
                    error: queryResult.error,
                }
            }),
        (a, b) => a === b,
    )
}

/**
 * Type helper to extract entity type from stateful atom family
 */
export type StatefulEntityResult<T> = T extends (id: string) => Atom<infer R> ? R : never
