/**
 * App Status atoms for CustomWorkflowBanner
 *
 * Detects whether a custom workflow app is reachable by calling
 * its /inspect endpoint. The banner is shown when the probe fails.
 */

import {inspectWorkflow} from "@agenta/entities/workflow"
import {workflowRevisionsByWorkflowListDataAtomFamily} from "@agenta/entities/workflow"
import {projectIdAtom} from "@agenta/shared/state"
import {atom} from "jotai"
import {selectAtom} from "jotai/utils"
import {atomWithQuery} from "jotai-tanstack-query"

import {currentAppAtom} from "@/oss/state/app"
import {selectedAppIdAtom} from "@/oss/state/app/selectors/app"
import {appStateSnapshotAtom} from "@/oss/state/appState"

const appReachabilityQueryAtom = atomWithQuery<boolean>((get) => {
    const currentAppId = get(selectedAppIdAtom)
    const appId = typeof currentAppId === "string" ? currentAppId : ""
    const currentApp = get(currentAppAtom)
    const isCustomApp = !!currentApp?.flags?.is_custom
    const projectId = get(projectIdAtom)

    // Only probe reachability for custom workflow apps.
    if (!isCustomApp || !appId || !projectId) {
        return {
            queryKey: ["appReachability", appId, ""],
            queryFn: async () => false,
            enabled: false,
        }
    }

    const appState = get(appStateSnapshotAtom)
    const isPlayground = appState.pathname?.includes("/playground")
    const isVariantDrawer = appState.pathname?.includes("/variants")
    const isAppsPage = appState.pathname?.endsWith("/apps")
    const shouldSkip = isPlayground || isVariantDrawer || isAppsPage

    // Only subscribe to the revisions atom when we actually need it.
    const revision = !shouldSkip
        ? get(workflowRevisionsByWorkflowListDataAtomFamily(appId))[0]
        : undefined

    const uri = revision?.data?.uri as string | undefined
    const serviceUrl = revision?.data?.url as string | undefined

    const canProbe = !!uri && !!serviceUrl && !shouldSkip

    return {
        queryKey: ["appReachability", appId, uri ?? "", serviceUrl ?? "", projectId],
        queryFn: async () => {
            if (!uri || !serviceUrl || !projectId) return false
            try {
                const result = await inspectWorkflow(uri, projectId, serviceUrl)
                // Any non-empty response means the service is reachable
                return !!result && Object.keys(result).length > 0
            } catch {
                return false
            }
        },
        placeholderData: (previousData: boolean | undefined) => previousData,
        enabled: canProbe,
        refetchInterval: 1000 * 60 * 1,
    }
})

const appStatusLoadingAtom = selectAtom(
    appReachabilityQueryAtom,
    (q: any) => !q?.isFetched,
    Object.is,
)

const appStatusAtom = atom((get) => {
    const q: any = get(appReachabilityQueryAtom)
    return (q?.status ?? "loading") === "success" && q?.data === true
})

export const customWorkflowBannerVisibleAtom = atom((get) => {
    const currentApp = get(currentAppAtom)
    const isAppUp = get(appStatusAtom)
    const isLoading = get(appStatusLoadingAtom)
    return !!currentApp?.flags?.is_custom && !isLoading && !isAppUp
})
