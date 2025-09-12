import {atom} from "jotai"
import {atomWithStorage} from "jotai/utils"

import {routerAppIdAtom, recentAppIdAtom} from "../../../../state/app/atoms/fetcher"
import type {PlaygroundState, TestRunState, ViewType} from "../types"

/**
 * Phase 2.1: Playground State Foundation
 * Core atoms for playground state management with strict typing
 */

// Core playground state container
const initialPlaygroundState: PlaygroundState = {
    generationData: {
        inputs: {__id: "inputs", value: [], __metadata: {}},
        messages: {__id: "messages", value: [], __metadata: {}},
    },
    metadata: {},
}

export const playgroundStateAtom = atom(initialPlaygroundState)

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

/**
 * Phase 2.2: Generation Data Management
 */

// Note: Generation data is now stored in playgroundStateAtom.generationData
// This eliminates data consistency issues and provides a single source of truth

// Track test execution per variant/row with strict typing
export const testRunStatesAtom = atom<Record<string, Record<string, TestRunState>>>({})

// Track if generation inputs have been modified per selected revision
const generationInputsDirtyByAppAtom = atomWithStorage<Record<string, Record<string, boolean>>>(
    "agenta_generation_inputs_dirty_v2",
    {},
)

export const generationInputsDirtyAtom = atom(
    (get) => {
        const appId = get(routerAppIdAtom) || get(recentAppIdAtom) || "__global__"
        const all = get(generationInputsDirtyByAppAtom)
        return all[appId] || {}
    },
    (
        get,
        set,
        next:
            | Record<string, boolean>
            | ((prev: Record<string, boolean>) => Record<string, boolean>),
    ) => {
        const appId = get(routerAppIdAtom) || get(recentAppIdAtom) || "__global__"
        const all = get(generationInputsDirtyByAppAtom)
        const prev = all[appId] || {}
        const value = typeof next === "function" ? (next as any)(prev) : next
        set(generationInputsDirtyByAppAtom, {...all, [appId]: value})
    },
)
