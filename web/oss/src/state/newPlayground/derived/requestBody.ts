import {atom} from "jotai"

import {transformToRequestBody} from "@/oss/lib/shared/variant/transformer/transformToRequestBody"

import {playgroundConfigAtom} from "../core/config"
import {currentAppContextAtom} from "@/oss/state/newApps/selectors/apps"
import type {DerivedRequestBody} from "../types"

/**
 * Derived Request Body Atoms
 *
 * These atoms always calculate request bodies from current config state.
 * No more manual transformToRequestBody calls - always up to date!
 */

// Transform variant config to request body using existing helper
export const transformVariantToRequestBody = (variant: any, appType?: string): any => {
    if (!variant) return null

    try {
        // Use the existing transformToRequestBody helper
        const requestBody = transformToRequestBody({variant, appType})
        return requestBody
    } catch (error) {
        console.error("❌ Error transforming variant to request body:", error)
        return null
    }
}

// Derived request body for selected variant
export const selectedVariantRequestBodyAtom = atom<DerivedRequestBody | null>((get) => {
    const config = get(playgroundConfigAtom)
    const selectedVariant = config.variants[config.selectedVariantId]

    if (!selectedVariant) return null

    try {
        const appType = get(currentAppContextAtom)?.appType || undefined
        const requestBody = transformVariantToRequestBody(selectedVariant, appType)
        return {
            variantId: selectedVariant.id,
            requestBody,
            isValid: !!requestBody,
            validationErrors: [],
        }
    } catch (error) {
        return {
            variantId: selectedVariant.id,
            requestBody: null,
            isValid: false,
            validationErrors: [error instanceof Error ? error.message : "Unknown error"],
        }
    }
})

// Derived request bodies for all displayed variants
export const displayedVariantsRequestBodiesAtom = atom<DerivedRequestBody[]>((get) => {
    const config = get(playgroundConfigAtom)

    return config.displayedVariantIds.map((variantId) => {
        const variant = config.variants[variantId]
        if (!variant) {
            return {
                variantId,
                requestBody: null,
                isValid: false,
                validationErrors: ["Variant not found"],
            }
        }

        try {
            const appType = get(currentAppContextAtom)?.appType || undefined
            const requestBody = transformVariantToRequestBody(variant, appType)
            return {
                variantId,
                requestBody,
                isValid: !!requestBody,
                validationErrors: [],
            }
        } catch (error) {
            return {
                variantId,
                requestBody: null,
                isValid: false,
                validationErrors: [error instanceof Error ? error.message : "Unknown error"],
            }
        }
    })
})

// Get request body for specific variant
export const getVariantRequestBodyAtom = atom(
    null,
    (get, set, variantId: string): DerivedRequestBody | null => {
        const config = get(playgroundConfigAtom)
        const variant = config.variants[variantId]

        if (!variant) return null

        try {
            const appType = get(currentAppContextAtom)?.appType || undefined
            const requestBody = transformVariantToRequestBody(variant, appType)
            return {
                variantId,
                requestBody,
                isValid: !!requestBody,
                validationErrors: [],
            }
        } catch (error) {
            return {
                variantId,
                requestBody: null,
                isValid: false,
                validationErrors: [error instanceof Error ? error.message : "Unknown error"],
            }
        }
    },
)
