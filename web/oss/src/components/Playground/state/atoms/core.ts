import {atom} from "jotai"
import {atomWithStorage} from "jotai/utils"

import {routerAppIdAtom, recentAppIdAtom} from "../../../../state/app/atoms/fetcher"
import type {TestRunState, ViewType} from "../types"

// Currently displayed variant IDs (per app)
const selectedVariantsByAppAtom = atomWithStorage<Record<string, string[]>>(
    "agenta_selected_revisions_v2",
    {},
)

export const selectedVariantsAtom = atom(
    (get) => {
        const appId = get(routerAppIdAtom) || get(recentAppIdAtom) || "__global__"
        const all = get(selectedVariantsByAppAtom)
        return all[appId] || []
    },
    (get, set, next: string[]) => {
        const appId = get(routerAppIdAtom) || get(recentAppIdAtom) || "__global__"
        const all = get(selectedVariantsByAppAtom)
        set(selectedVariantsByAppAtom, {...all, [appId]: next})
    },
)

// Single or comparison view
export const viewTypeAtom = atom<ViewType>("single")

// View state only — generation data lives in normalized entities

// Track test execution per variant/row with strict typing
export const testRunStatesAtom = atom<Record<string, Record<string, TestRunState>>>({})
