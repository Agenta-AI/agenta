import {
    workflowRevisionDrawerOpenAtom,
    workflowRevisionDrawerEntityIdAtom,
    workflowRevisionDrawerContextAtom,
    closeWorkflowRevisionDrawerAtom,
    openWorkflowRevisionDrawerAtom,
    type DrawerContext,
} from "@agenta/playground-ui/workflow-revision-drawer"
import {getDefaultStore} from "jotai"
import Router from "next/router"

import {isDrawerSupportedRoute} from "./routeMatchers"

const isBrowser = typeof window !== "undefined"

// Tracks whether the current drawer was opened via URL (revisionId param).
// Only URL-driven drawers should be closed by URL sync. Drawers opened
// programmatically (e.g. evaluator drawer from table click without URL param)
// are immune to URL-based closing.
let drawerOpenedViaUrl = false

export const clearVariantDrawerState = () => {
    const store = getDefaultStore()
    const isOpen = store.get(workflowRevisionDrawerOpenAtom)

    if (isOpen) {
        store.set(closeWorkflowRevisionDrawerAtom)
    }
    drawerOpenedViaUrl = false
}

const VALID_DRAWER_TYPES = new Set<DrawerContext>([
    "variant",
    "deployment",
    "evaluator-view",
    "evaluator-create",
])

const resolveDrawerContextForPath = (pathname: string, tab?: string | null): DrawerContext => {
    if (pathname.includes("/evaluators")) {
        return "evaluator-view"
    }
    if (tab === "deployments" || pathname.includes("/deployments")) {
        return "deployment"
    }
    return "variant"
}

const sanitizeDrawerType = (value: string | null): DrawerContext | undefined => {
    if (!value) return undefined
    const normalized = value.trim().toLowerCase() as DrawerContext
    return VALID_DRAWER_TYPES.has(normalized) ? normalized : undefined
}

export const syncVariantStateFromUrl = (nextUrl?: string) => {
    if (!isBrowser) return

    try {
        const store = getDefaultStore()
        const url = new URL(nextUrl ?? window.location.href, window.location.origin)
        const revisionParam = url.searchParams.get("revisionId")
        const resolvedRevisionId = revisionParam?.trim() || undefined
        const drawerTypeParam = url.searchParams.get("drawerType")
        const tabParam = url.searchParams.get("tab")
        const routeSupportsDrawer = isDrawerSupportedRoute(url.pathname)
        const currentEntityId = store.get(workflowRevisionDrawerEntityIdAtom)
        const currentOpen = store.get(workflowRevisionDrawerOpenAtom)
        const currentContext = store.get(workflowRevisionDrawerContextAtom)

        const ensureUrlClean = () => {
            let mutated = false
            if (url.searchParams.has("drawerType")) {
                const sanitized = sanitizeDrawerType(url.searchParams.get("drawerType"))
                if (!sanitized) {
                    url.searchParams.delete("drawerType")
                    mutated = true
                } else if (url.searchParams.get("drawerType") !== sanitized) {
                    url.searchParams.set("drawerType", sanitized)
                    mutated = true
                }
            }
            if (mutated) {
                const newPath = `${url.pathname}${url.search}${url.hash}`
                void Router.replace(newPath, undefined, {shallow: true}).catch((error) => {
                    console.error("Failed to normalize drawer query params:", error)
                })
            }
        }

        if (!routeSupportsDrawer) {
            if ((revisionParam && revisionParam.trim()) || url.searchParams.has("drawerType")) {
                url.searchParams.delete("revisionId")
                url.searchParams.delete("drawerType")
                const newPath = `${url.pathname}${url.search}${url.hash}`
                void Router.replace(newPath, undefined, {shallow: true}).catch((error) => {
                    console.error("Failed to remove unsupported drawer query params:", error)
                })
            }
            clearVariantDrawerState()
            return
        }

        if (!resolvedRevisionId) {
            ensureUrlClean()
            // Only close the drawer if it was originally opened via URL
            // (revisionId param). Programmatically opened drawers (e.g.
            // evaluator drawer) should not be closed by unrelated URL changes.
            if (currentOpen && drawerOpenedViaUrl) {
                clearVariantDrawerState()
            }
            return
        }

        ensureUrlClean()

        const desiredType =
            sanitizeDrawerType(drawerTypeParam) ??
            resolveDrawerContextForPath(url.pathname, tabParam)

        if (
            currentEntityId === resolvedRevisionId &&
            currentOpen &&
            currentContext === desiredType
        ) {
            return
        }

        drawerOpenedViaUrl = true
        store.set(openWorkflowRevisionDrawerAtom, {
            entityId: resolvedRevisionId,
            context: desiredType,
        })
    } catch (err) {
        console.error("Failed to sync drawer state from URL:", nextUrl, err)
    }
}
