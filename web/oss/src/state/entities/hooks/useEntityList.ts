import {useAtomValue, useSetAtom} from "jotai"
import {useEffect} from "react"

import type {BaseEntity, EntityStore} from "../core/types"

/**
 * Hook to fetch a list of entities with automatic normalized cache hydration
 *
 * @example
 * ```ts
 * const testcases = useEntityList(testcaseStore, {
 *   revisionId: 'rev-123',
 *   limit: 50
 * })
 *
 * // Now individual entities are in cache and can be accessed via useEntityCached
 * ```
 */
export function useEntityList<
    TEntity extends BaseEntity,
    TListParams extends Record<string, any>,
    TListResponse,
    TDetailParams extends Record<string, any>,
>(
    store: EntityStore<TEntity, TListParams, TListResponse, TDetailParams>,
    params: TListParams,
    options?: {
        /** Manually extract entities if different from config */
        extractEntities?: (response: TListResponse) => TEntity[]
        /** Disable automatic hydration */
        disableHydration?: boolean
    },
) {
    const queryAtom = store.listQueryAtom(params)
    const query = useAtomValue(queryAtom)
    const upsertMany = useSetAtom(store.upsertManyAtom)

    // Hydrate normalized store when data arrives
    useEffect(() => {
        if (query.data && !options?.disableHydration) {
            const entities = options?.extractEntities
                ? options.extractEntities(query.data)
                : // Fallback: try to extract from common response shapes
                  Array.isArray(query.data)
                  ? query.data
                  : ((query.data as any).data ?? (query.data as any).items ?? [])

            if (Array.isArray(entities) && entities.length > 0) {
                upsertMany(entities as TEntity[])
            }
        }
    }, [query.data, upsertMany, options?.disableHydration, options?.extractEntities])

    return {
        data: query.data ?? null,
        isLoading: query.isLoading,
        isFetching: query.isFetching,
        isError: query.isError,
        error: query.error,
        refetch: query.refetch,
    }
}
