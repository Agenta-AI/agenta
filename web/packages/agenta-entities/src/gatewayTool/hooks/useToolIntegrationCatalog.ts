// The COMPLETE action catalog for one integration, as a single settled query.
// Separate from the paginated, search-driven `useToolCatalogActions`: a permission editor has to
// describe the WHOLE integration, and every such answer is wrong against a partial list.
import {catalogPersister} from "@agenta/shared/api/persist"
import {projectIdAtom} from "@agenta/shared/state"
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
/** Bounds a provider that ignores `limit`; 5000 actions is far past any real integration. */
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
    // Fail rather than resolve short: a truncated list would report itself complete.
    if (cursor) throw new Error(`Tool catalog for "${integrationKey}" exceeded ${MAX_PAGES} pages`)
    return actions
}

export const toolIntegrationCatalogQueryFamily = atomFamily((integrationKey: string) =>
    atomWithQuery<CatalogActionItem[]>((get) => {
        // The request is project-scoped, so the key must be too, or a project switch reads the
        // previous project's catalog — which the persister keeps across reloads.
        const projectId = get(projectIdAtom)
        return {
            queryKey: [
                "tools",
                "catalog",
                "integrationCatalog",
                projectId,
                DEFAULT_PROVIDER,
                integrationKey,
            ],
            queryFn: () => fetchWholeCatalog(integrationKey),
            staleTime: 5 * 60_000,
            refetchOnWindowFocus: false,
            enabled: !!integrationKey && !!projectId,
            persister: catalogPersister.persisterFn<CatalogActionItem[], QueryKey>,
        }
    }),
)

export const useToolIntegrationCatalog = (integrationKey: string) => {
    const query = useAtomValue(toolIntegrationCatalogQueryFamily(integrationKey))
    return {
        actions: query.data ?? [],
        /** The catalog is whole. False while loading and after a failure. */
        complete: query.isSuccess,
        isLoading: query.isPending,
        error: query.error,
    }
}
