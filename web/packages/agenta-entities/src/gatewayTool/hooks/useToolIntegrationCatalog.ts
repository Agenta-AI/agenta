/**
 * The COMPLETE action catalog for one integration, as a single settled query.
 *
 * Separate from {@link useToolCatalogActions}, which is the browse query: paginated, driven by a
 * module-level search atom, and shared with the action pickers. A permission editor cannot use
 * that one — it has to describe the whole integration (how many tools there are, which are
 * read-only, which saved keys the provider no longer lists), and every one of those answers is
 * wrong against a partial list. Sharing the browse query would also mean sharing its search atom,
 * so one surface's typing would narrow another's catalog.
 *
 * The catalog endpoint takes up to 1000 actions per request, which covers every integration the
 * provider offers today, so this is one request in the normal case. The cursor loop is a bounded
 * fallback for a provider that caps its own page size; the query resolves only when the catalog is
 * complete, so a consumer never sees a half-filled list.
 */
import {catalogPersister} from "@agenta/shared/api/persist"
import type {QueryKey} from "@tanstack/react-query"
import {useAtomValue} from "jotai"
import {atomFamily} from "jotai-family"
import {atomWithQuery} from "jotai-tanstack-query"

import {fetchToolActions} from "../api"
import type {ToolCatalogAction, ToolCatalogActionDetails} from "../core/types"

type CatalogActionItem = ToolCatalogAction | ToolCatalogActionDetails

const DEFAULT_PROVIDER = "composio"
/** The catalog endpoint's own maximum (`MAX_PAGE_SIZE` in the Composio adapter). */
const PAGE_SIZE = 1000
/** Stops a provider that ignores `limit` from looping forever. 5000 actions is far past any
 *  real integration, so hitting this means something is wrong upstream, not a big catalog. */
const MAX_PAGES = 5

async function fetchWholeCatalog(integrationKey: string): Promise<CatalogActionItem[]> {
    const actions: CatalogActionItem[] = []
    let cursor: string | undefined
    for (let page = 0; page < MAX_PAGES; page++) {
        const response = await fetchToolActions(DEFAULT_PROVIDER, integrationKey, {
            limit: PAGE_SIZE,
            cursor,
        })
        actions.push(...(response.actions ?? []))
        cursor = response.cursor ?? undefined
        if (!cursor) break
    }
    return actions
}

export const toolIntegrationCatalogQueryFamily = atomFamily((integrationKey: string) =>
    atomWithQuery<CatalogActionItem[]>(() => ({
        queryKey: ["tools", "catalog", "integrationCatalog", DEFAULT_PROVIDER, integrationKey],
        queryFn: () => fetchWholeCatalog(integrationKey),
        staleTime: 5 * 60_000,
        refetchOnWindowFocus: false,
        enabled: !!integrationKey,
        persister: catalogPersister.persisterFn<CatalogActionItem[], QueryKey>,
    })),
)

export const useToolIntegrationCatalog = (integrationKey: string) => {
    const query = useAtomValue(toolIntegrationCatalogQueryFamily(integrationKey))
    return {
        actions: query.data ?? [],
        /** The catalog is whole. False while loading and after a failure — a caller must not
         *  describe the integration from a list that is neither. */
        complete: query.isSuccess,
        isLoading: query.isPending,
        error: query.error,
    }
}
