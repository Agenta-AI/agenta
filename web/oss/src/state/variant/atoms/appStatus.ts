import {atom} from "jotai"
import {atomFamily} from "jotai/utils"

import {currentAppAtom} from "@/oss/state/app"

import {appUriStateQueryAtom, appStatusLoadingAtom} from "./fetcher"

/**
 * App Status Management (app-wide)
 *
 * Status is true when the app-level OpenAPI schema is available.
 */

// Global app status for the current app (app-wide)
// True only when OpenAPI query is successful AND schema is present.
// This leverages polling on custom apps to keep status up to date.
export const appStatusAtom = atom((get) => {
    const q: any = get(appUriStateQueryAtom)
    const hasSchema = Boolean(q?.data?.schema ?? q?.schema)
    return (q?.status ?? "loading") === "success" && hasSchema
})

// Legacy atom family for backwards compatibility (derives from query)
export const variantAppStatusAtomFamily = atomFamily((variantId: string) =>
    atom((get) => get(appStatusAtom)),
)

// Derived atom to get app status for current variant (alias to app-wide status)
export const currentVariantAppStatusAtom = appStatusAtom

// Single selector for CustomWorkflowBanner visibility (centralized)
export const customWorkflowBannerVisibleAtom = atom((get) => {
    const currentApp = get(currentAppAtom)
    const isAppUp = get(appStatusAtom)
    const isLoading = get(appStatusLoadingAtom)
    return currentApp?.app_type === "custom" && !isLoading && !isAppUp
})
