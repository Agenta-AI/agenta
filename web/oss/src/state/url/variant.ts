import {getDefaultStore} from "jotai"
import Router from "next/router"

import {
    variantDrawerAtom,
    drawerVariantIdAtom,
} from "@/oss/components/VariantsComponents/Drawers/VariantDrawer/store/variantDrawerStore"
import {revisionListAtom} from "@/oss/state/variant/selectors/variant"

import {isVariantSupportedRoute} from "./routeMatchers"

const isBrowser = typeof window !== "undefined"

export const clearVariantDrawerState = () => {
    const store = getDefaultStore()
    const current = store.get(variantDrawerAtom)

    if (current.open || current.selectedVariantId) {
        store.set(variantDrawerAtom, (draft) => {
            draft.open = false
            draft.selectedVariantId = undefined
            draft.type = "variant"
        })
        store.set(drawerVariantIdAtom, null)
    }
}

const resolveDrawerTypeForPath = (pathname: string): "variant" | "deployment" => {
    if (pathname.includes("/deployments")) {
        return "deployment"
    }
    return "variant"
}

export const syncVariantStateFromUrl = (nextUrl?: string) => {
    if (!isBrowser) return

    try {
        const store = getDefaultStore()
        const url = new URL(nextUrl ?? window.location.href, window.location.origin)
        const revisionParam = url.searchParams.get("revisionId")
        const resolvedRevisionId = revisionParam?.trim() || undefined
        const drawerTypeParam = url.searchParams.get("drawerType")
        const routeSupportsVariant = isVariantSupportedRoute(url.pathname)
        const currentState = store.get(variantDrawerAtom)

        const sanitizeDrawerType = (value: string | null): "variant" | "deployment" | undefined => {
            if (!value) return undefined
            const normalized = value.trim().toLowerCase()
            if (normalized === "deployment") return "deployment"
            if (normalized === "variant") return "variant"
            return undefined
        }

        const ensureUrlClean = () => {
            let mutated = false
            if (url.searchParams.has("revisions")) {
                url.searchParams.delete("revisions")
                mutated = true
            }
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
                    console.error("Failed to normalize variant drawer query params:", error)
                })
            }
        }

        if (!routeSupportsVariant) {
            if (
                (revisionParam && revisionParam.trim()) ||
                url.searchParams.has("revisions") ||
                url.searchParams.has("drawerType")
            ) {
                url.searchParams.delete("revisionId")
                url.searchParams.delete("revisions")
                url.searchParams.delete("drawerType")
                const newPath = `${url.pathname}${url.search}${url.hash}`
                void Router.replace(newPath, undefined, {shallow: true}).catch((error) => {
                    console.error("Failed to remove unsupported variant query params:", error)
                })
            }
            clearVariantDrawerState()
            store.set(drawerVariantIdAtom, null)
            return
        }

        if (!resolvedRevisionId) {
            ensureUrlClean()
            if (currentState.open || currentState.selectedVariantId) {
                clearVariantDrawerState()
            }
            store.set(drawerVariantIdAtom, null)
            return
        }

        ensureUrlClean()

        const desiredType =
            sanitizeDrawerType(drawerTypeParam) ?? resolveDrawerTypeForPath(url.pathname)

        if (
            currentState.selectedVariantId === resolvedRevisionId &&
            currentState.open &&
            currentState.type === desiredType
        ) {
            store.set(drawerVariantIdAtom, resolvedRevisionId)
            return
        }

        store.set(variantDrawerAtom, (draft) => {
            if (!draft.variantsAtom) {
                draft.variantsAtom = revisionListAtom
            }
            draft.type = desiredType
            draft.open = true
            draft.selectedVariantId = resolvedRevisionId
        })
        store.set(drawerVariantIdAtom, resolvedRevisionId)
    } catch (err) {
        console.error("Failed to sync variant drawer state from URL:", nextUrl, err)
    }
}
