/**
 * App Status atoms for CustomWorkflowBanner
 *
 * Detects whether a custom workflow app is reachable by probing
 * its OpenAPI schema endpoint. The banner is shown when the probe fails.
 */

import {
    fetchRevisionSchemaWithProbe,
    variantsListAtomFamily,
} from "@agenta/entities/legacyAppRevision"
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
    const variants = appId ? get(variantsListAtomFamily(appId)) : []
    const firstUri = (variants[0] as any)?.uri as string | undefined
    const appType = get(currentAppContextAtom)?.appType || null
    const isCustomApp = appType === "custom"

    const appState = get(appStateSnapshotAtom)
    const isPlayground = appState.pathname?.includes("/playground")
    const isVariantDrawer = appState.pathname?.includes("/variants")
    const shouldSkipLegacyFetch = isPlayground || isVariantDrawer

    return {
        queryKey: ["appSpec", appId, firstUri ?? ""],
        queryFn: async () => {
            if (!firstUri) return undefined
            const result = await fetchRevisionSchemaWithProbe(firstUri)
            if (!result) throw new Error("openapi.json not found")
            return result as UriState
        },
        staleTime: isCustomApp ? undefined : 1000 * 60 * 5,
        placeholderData: (previousData) => previousData,
        enabled: !!firstUri && !shouldSkipLegacyFetch,
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
    return currentApp?.app_type === "custom" && !isLoading && !isAppUp
})
