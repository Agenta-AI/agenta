import {atom} from "jotai"
import {atomWithStorage} from "jotai/utils"

import {routerAppIdAtom, recentAppIdAtom} from "../../../../state/app/atoms/fetcher"
import type {TestRunState, ViewType} from "../types"

// Currently displayed variant IDs (per app)
const selectedVariantsByAppAtom = atomWithStorage<Record<string, string[]>>(
    "agenta_selected_revisions_v2",
    {},
)

// Track if storage has been hydrated (first read/write indicates hydration is complete)
let storageHydrated = false

export const selectedVariantsAtom = atom(
    (get) => {
        storageHydrated = true // Mark as hydrated on first read
        const appId = get(routerAppIdAtom) || get(recentAppIdAtom) || "__global__"
        const all = get(selectedVariantsByAppAtom)
        return all[appId] || []
    },
    (get, set, next: string[] | ((prev: string[]) => string[])) => {
        storageHydrated = true // Mark as hydrated on first write
        const appId = get(routerAppIdAtom) || get(recentAppIdAtom) || "__global__"
        const all = get(selectedVariantsByAppAtom)
        const current = all[appId] || []
        // Support both direct value and updater function patterns
        const newValue = typeof next === "function" ? next(current) : next
        set(selectedVariantsByAppAtom, {...all, [appId]: newValue})
    },
)

/**
 * Check if the selection storage has been hydrated from localStorage.
 * This is used to prevent ensurePlaygroundDefaults from overwriting
 * persisted selections before they've been loaded.
 */
export const isSelectionStorageHydrated = () => storageHydrated

// Single or comparison view
export const viewTypeAtom = atom<ViewType>("single")

// View state only — generation data lives in normalized entities

// Track test execution per variant/row with strict typing
export const testRunStatesAtom = atom<Record<string, Record<string, TestRunState>>>({})
