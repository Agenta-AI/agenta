import {produce} from "immer"
import {atom} from "jotai"

import {generateId} from "@/oss/lib/shared/variant/stringUtils"

import type {PlaygroundConfig, PlaygroundVariantConfig} from "../types"

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

// Selected variant atom - derived from config
export const selectedVariantAtom = atom(
    (get) => {
        const config = get(playgroundConfigAtom)
        return config.variants[config.selectedVariantId] || null
    },
    (get, set, variantId: string) => {
        set(
            playgroundConfigAtom,
            produce((draft) => {
                if (draft.variants[variantId]) {
                    draft.selectedVariantId = variantId
                }
            }),
        )
    },
)

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

// Initialize playground with variants from revisions
export const initializePlaygroundAtom = atom(null, (get, set, revisions: any[]) => {
    const variants: Record<string, PlaygroundVariantConfig> = {}

    revisions.forEach((revision) => {
        if (revision.prompts) {
            variants[revision.id] = {
                id: revision.id,
                name: revision.name || `Variant ${revision.id}`,
                isChatVariant: revision.isChatVariant || false,
                prompts: revision.prompts,
                parameters: revision.parameters || {},
                metadata: {
                    createdAt: Date.now(),
                    updatedAt: Date.now(),
                    originalRevisionId: revision.id,
                },
            }
        }
    })

    const firstVariantId = Object.keys(variants)[0] || ""

    set(playgroundConfigAtom, {
        variants,
        selectedVariantId: firstVariantId,
        displayedVariantIds: Object.keys(variants),
    })
})

// Add new variant
export const addVariantAtom = atom(null, (get, set, baseVariantId?: string) => {
    const config = get(playgroundConfigAtom)
    const baseVariant = baseVariantId
        ? config.variants[baseVariantId]
        : config.variants[config.selectedVariantId]

    if (!baseVariant) return

    const newVariantId = generateId()
    const newVariant: PlaygroundVariantConfig = {
        id: newVariantId,
        name: `${baseVariant.name} Copy`,
        isChatVariant: baseVariant.isChatVariant,
        prompts: structuredClone(baseVariant.prompts),
        parameters: structuredClone(baseVariant.parameters),
        metadata: {
            createdAt: Date.now(),
            updatedAt: Date.now(),
        },
    }

    set(
        playgroundConfigAtom,
        produce((draft) => {
            draft.variants[newVariantId] = newVariant
            draft.displayedVariantIds.push(newVariantId)
        }),
    )

    return newVariantId
})

// Delete variant
export const deleteVariantAtom = atom(null, (get, set, variantId: string) => {
    set(
        playgroundConfigAtom,
        produce((draft) => {
            delete draft.variants[variantId]
            draft.displayedVariantIds = draft.displayedVariantIds.filter((id) => id !== variantId)

            // If deleted variant was selected, select another one
            if (draft.selectedVariantId === variantId) {
                draft.selectedVariantId = draft.displayedVariantIds[0] || ""
            }
        }),
    )
})

// Update variant config (prompts, parameters)
export const updateVariantConfigAtom = atom(
    null,
    (get, set, params: {variantId: string; path: string[]; value: any}) => {
        const {variantId, path, value} = params

        set(
            playgroundConfigAtom,
            produce((draft) => {
                const variant = draft.variants[variantId]
                if (!variant) return

                // Navigate to the target property and update it
                let target: any = variant
                for (let i = 0; i < path.length - 1; i++) {
                    if (!target[path[i]]) target[path[i]] = {}
                    target = target[path[i]]
                }

                target[path[path.length - 1]] = value
                variant.metadata.updatedAt = Date.now()
            }),
        )
    },
)
