import {useMemo} from "react"

import {useAtomValue} from "jotai"
import {atomWithQuery} from "jotai-tanstack-query"

import {fetchToolCategories} from "../api"
import type {ToolCatalogCategory, ToolCatalogCategoriesResponse} from "../core/types"

const DEFAULT_PROVIDER = "composio"

// Categories change rarely; cache them generously. Failure here must NOT break the
// rest of the drawer (ALL APPS + search still work) — consumers read `error` and
// simply omit the "Browse by category" group.
export const toolCatalogCategoriesQueryAtom = atomWithQuery<ToolCatalogCategoriesResponse>(() => ({
    queryKey: ["tools", "catalog", "categories", DEFAULT_PROVIDER],
    queryFn: () => fetchToolCategories(DEFAULT_PROVIDER),
    staleTime: 30 * 60_000,
    refetchOnWindowFocus: false,
    retry: 1,
}))

export const useToolCatalogCategories = () => {
    const query = useAtomValue(toolCatalogCategoriesQueryAtom)

    // Composio's categories endpoint returns duplicate slugs — dedupe by id so React keys stay
    // unique (a duplicate key crashes the list render).
    const categories = useMemo(() => {
        const seen = new Set<string>()
        const out: ToolCatalogCategory[] = []
        for (const c of query.data?.categories ?? []) {
            if (!c?.id || seen.has(c.id)) continue
            seen.add(c.id)
            out.push(c)
        }
        return out
    }, [query.data?.categories])

    return {
        categories,
        isLoading: query.isPending,
        error: query.error,
        refetch: query.refetch,
    }
}
