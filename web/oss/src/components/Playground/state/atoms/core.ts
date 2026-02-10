import {atom} from "jotai"

import {routerAppIdAtom, recentAppIdAtom} from "../../../../state/app/atoms/fetcher"
import type {TestRunState} from "../types"

// Currently displayed variant IDs (per app)
// No localStorage persistence - URL is the source of truth for sharing.
const selectedVariantsByAppAtom = atom<Record<string, string[]>>({})

export const selectedVariantsAtom = atom(
    (get) => {
        const appId = get(routerAppIdAtom) || get(recentAppIdAtom) || "__global__"
        const all = get(selectedVariantsByAppAtom)
        return all[appId] || []
    },
    (get, set, next: string[] | ((prev: string[]) => string[])) => {
        const appId = get(routerAppIdAtom) || get(recentAppIdAtom) || "__global__"
        const all = get(selectedVariantsByAppAtom)
        const current = all[appId] || []
        // Support both direct value and updater function patterns
        const rawValue = typeof next === "function" ? next(current) : next
        // Deduplicate while preserving order — prevents duplicate key warnings
        // and incorrect bulk-removal when async operations (commit, URL sync)
        // race to update the selection.
        const seen = new Set<string>()
        const newValue = rawValue.filter((id) => {
            if (seen.has(id)) return false
            seen.add(id)
            return true
        })
        set(selectedVariantsByAppAtom, {...all, [appId]: newValue})
    },
)

/**
 * Check if the selection storage has been hydrated.
 * With no localStorage, this is always true (no async hydration needed).
 */
export const isSelectionStorageHydrated = () => true

// View state only — generation data lives in normalized entities

// Track test execution per variant/row with strict typing
export const testRunStatesAtom = atom<Record<string, Record<string, TestRunState>>>({})
