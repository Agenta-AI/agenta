import {useAtomValue, useSetAtom} from "jotai"

import type {BaseEntity, EntityMetadata, EntityStore} from "../core/types"

/**
 * Hook to read a single entity with automatic fetching
 *
 * @example
 * ```ts
 * const testcase = useEntity(testcaseStore, { id: 'tc-123' })
 * if (testcase.isLoading) return <Spinner />
 * return <div>{testcase.data?.name}</div>
 * ```
 */
export function useEntity<
    TEntity extends BaseEntity,
    TListParams extends Record<string, any>,
    TListResponse,
    TDetailParams extends Record<string, any>,
>(store: EntityStore<TEntity, TListParams, TListResponse, TDetailParams>, params: TDetailParams) {
    const id = (params as any).id as string

    // Try to get from normalized cache first
    const cachedEntity = useAtomValue(store.entityAtomFamily(id))

    // Trigger detail query (will use cache as placeholder if available)
    const queryAtom = store.detailQueryAtom(params)
    const query = useAtomValue(queryAtom)

    return {
        data: cachedEntity ?? query?.data ?? null,
        isLoading: query?.isLoading ?? false,
        isFetching: query?.isFetching ?? false,
        isError: query?.isError ?? false,
        error: query?.error ?? null,
        refetch: query?.refetch ?? (() => {}),
    }
}

/**
 * Hook to read a single entity from cache only (no fetching)
 * Useful when you know the entity is already in the cache from a list query
 */
export function useEntityCached<
    TEntity extends BaseEntity,
    TListParams extends Record<string, any>,
    TListResponse,
    TDetailParams extends Record<string, any>,
>(store: EntityStore<TEntity, TListParams, TListResponse, TDetailParams>, id: string) {
    return useAtomValue(store.entityAtomFamily(id))
}

/**
 * Hook to read entity metadata (isDirty, isStale, fetchedAt)
 * Useful for showing visual indicators for modified entities
 */
export function useEntityMetadata<
    TEntity extends BaseEntity,
    TListParams extends Record<string, any>,
    TListResponse,
    TDetailParams extends Record<string, any>,
>(
    store: EntityStore<TEntity, TListParams, TListResponse, TDetailParams>,
    id: string,
): EntityMetadata | null {
    return useAtomValue(store.entityMetadataAtomFamily(id))
}

/**
 * Hook to mutate a single entity
 */
export function useEntityMutation<
    TEntity extends BaseEntity,
    TListParams extends Record<string, any>,
    TListResponse,
    TDetailParams extends Record<string, any>,
>(store: EntityStore<TEntity, TListParams, TListResponse, TDetailParams>) {
    const upsert = useSetAtom(store.upsertAtom)
    const update = useSetAtom(store.updateAtom)
    const remove = useSetAtom(store.removeAtom)
    const invalidate = useSetAtom(store.invalidateAtom)
    const clearAllDirty = useSetAtom(store.clearAllDirtyAtom)
    const clearAll = useSetAtom(store.clearAllAtom)

    return {
        upsert,
        update,
        remove,
        invalidate,
        clearAllDirty,
        clearAll,
    }
}
