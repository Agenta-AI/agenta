import {produce} from "immer"
import {atom} from "jotai"

import type {PlaygroundConfig} from "../types"

/**
 * Core Config Atoms
 *
 * These atoms manage the mutable playground configuration independently from revisions.
 * No more sync overhead - configs are managed directly.
 */

// Core config state - mutable and independent from revisions
export const playgroundConfigAtom = atom<PlaygroundConfig>({
    variants: {},
    selectedVariantId: "",
    displayedVariantIds: [],
})

// Displayed variants atom - for comparison mode
export const displayedVariantsAtom = atom(
    (get) => {
        const config = get(playgroundConfigAtom)
        return config.displayedVariantIds.map((id) => config.variants[id]).filter(Boolean)
    },
    (get, set, variantIds: string[]) => {
        set(
            playgroundConfigAtom,
            produce((draft) => {
                // Only include variants that exist
                draft.displayedVariantIds = variantIds.filter((id) => draft.variants[id])
            }),
        )
    },
)
