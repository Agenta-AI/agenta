/**
 * App Status atoms for CustomWorkflowBanner
 *
 * Detects whether a custom workflow app is reachable by probing
 * its OpenAPI schema endpoint. The banner is shown when the probe fails.
 */

import {fetchRevisionSchemaWithProbe} from "@agenta/entities/shared/openapi"
import {workflowRevisionsByWorkflowListDataAtomFamily} from "@agenta/entities/workflow"
import {atom} from "jotai"
import {selectAtom} from "jotai/utils"
import {atomWithQuery} from "jotai-tanstack-query"

import {currentAppAtom} from "@/oss/state/app"
import {currentAppContextAtom, selectedAppIdAtom} from "@/oss/state/app/selectors/app"
import {appStateSnapshotAtom} from "@/oss/state/appState"

interface UriState {
    runtimePrefix: string
    routePath?: string
    schema: any
}

const appUriStateQueryAtom = atomWithQuery<UriState | undefined>((get) => {
    const currentAppId = get(selectedAppIdAtom)
    const appId = typeof currentAppId === "string" ? currentAppId : ""
    const appType = get(currentAppContextAtom)?.appType || null
    const isCustomApp = appType === "custom"

    const appState = get(appStateSnapshotAtom)
    const isPlayground = appState.pathname?.includes("/playground")
    const isVariantDrawer = appState.pathname?.includes("/variants")
    const isAppsPage = appState.pathname?.endsWith("/apps")
    const shouldSkipLegacyFetch = isPlayground || isVariantDrawer || isAppsPage

    // Only subscribe to the revisions atom when we actually need it.
    // Reading it unconditionally causes an expensive query on every page.
    const firstUrl =
        appId && !shouldSkipLegacyFetch
            ? (get(workflowRevisionsByWorkflowListDataAtomFamily(appId))[0]?.data?.url as
                  | string
                  | undefined)
            : undefined

    return {
        queryKey: ["appSpec", appId, firstUrl ?? ""],
        queryFn: async () => {
            if (!firstUrl) return undefined
            const result = await fetchRevisionSchemaWithProbe(firstUrl)
            if (!result) throw new Error("openapi.json not found")
            return result as UriState
        },
        staleTime: isCustomApp ? undefined : 1000 * 60 * 5,
        placeholderData: (previousData) => previousData,
        enabled: !!firstUrl && !shouldSkipLegacyFetch,
        refetchInterval: isCustomApp ? 1000 * 60 * 1 : false,
    }
})

const appStatusLoadingAtom = selectAtom(appUriStateQueryAtom, (q: any) => !q?.isFetched, Object.is)

const appStatusAtom = atom((get) => {
    const q: any = get(appUriStateQueryAtom)
    const hasSchema = Boolean(q?.data?.schema ?? q?.schema)
    return (q?.status ?? "loading") === "success" && hasSchema
})

export const customWorkflowBannerVisibleAtom = atom((get) => {
    const currentApp = get(currentAppAtom)
    const isAppUp = get(appStatusAtom)
    const isLoading = get(appStatusLoadingAtom)
    return !!currentApp?.flags?.is_custom && !isLoading && !isAppUp
})
