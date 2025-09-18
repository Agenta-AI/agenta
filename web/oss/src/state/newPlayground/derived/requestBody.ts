import {atom} from "jotai"

import {
    toRequestBodyChat,
    toRequestBodyCompletion,
} from "@/oss/lib/shared/variant/transformer/transformToRequestBody"
import {playgroundConfigAtom} from "../core/config"
import {currentAppContextAtom} from "@/oss/state/newApps/selectors/apps"
import {variantFlagsAtomFamily} from "../core/variantFlags"
import {promptsAtomFamily} from "../core/prompts"
import {customPropertiesByRevisionAtomFamily} from "../core/customProperties"
import {historyByRevisionAtomFamily} from "../chat/history"
import {appSchemaAtom, appUriInfoAtom} from "@/oss/state/variant/atoms/fetcher"
import type {DerivedRequestBody} from "../types"

/**
 * Derived Request Body Atoms
 *
 * These atoms always calculate request bodies from current config state.
 * No more manual transformToRequestBody calls - always up to date!
 */

// Derived request body for selected variant
export const selectedVariantRequestBodyAtom = atom<DerivedRequestBody | null>((get) => {
    const config = get(playgroundConfigAtom)
    const selectedVariant = config.variants[config.selectedVariantId]

    if (!selectedVariant) return null

    try {
        const appType = get(currentAppContextAtom)?.appType || undefined
        const revisionId = selectedVariant.id
        const isChat = !!get(variantFlagsAtomFamily({revisionId}))?.isChat
        const prompts = get(promptsAtomFamily(revisionId)) as any[]
        const customProps = get(customPropertiesByRevisionAtomFamily(revisionId)) as Record<
            string,
            any
        >
        const spec = get(appSchemaAtom)
        const routePath = get(appUriInfoAtom)?.routePath

        const requestBody = isChat
            ? toRequestBodyChat({
                  variant: selectedVariant as any,
                  prompts,
                  customProperties: customProps,
                  appType,
                  spec: spec as any,
                  routePath,
                  revisionId,
                  chatHistory: get(historyByRevisionAtomFamily(revisionId)) as any[],
              })
            : toRequestBodyCompletion({
                  variant: selectedVariant as any,
                  prompts,
                  customProperties: customProps,
                  appType,
                  spec: spec as any,
                  routePath,
              })
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
            const revisionId = variant.id
            const isChat = !!get(variantFlagsAtomFamily({revisionId}))?.isChat
            const prompts = get(promptsAtomFamily(revisionId)) as any[]
            const customProps = get(customPropertiesByRevisionAtomFamily(revisionId)) as Record<
                string,
                any
            >
            const spec = get(appSchemaAtom)
            const routePath = get(appUriInfoAtom)?.routePath
            const requestBody = isChat
                ? toRequestBodyChat({
                      variant: variant as any,
                      prompts,
                      customProperties: customProps,
                      appType,
                      spec: spec as any,
                      routePath,
                      revisionId,
                      chatHistory: get(historyByRevisionAtomFamily(revisionId)) as any[],
                  })
                : toRequestBodyCompletion({
                      variant: variant as any,
                      prompts,
                      customProperties: customProps,
                      appType,
                      spec: spec as any,
                      routePath,
                  })
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
            const revisionId = variant.id
            const isChat = !!get(variantFlagsAtomFamily({revisionId}))?.isChat
            const prompts = get(promptsAtomFamily(revisionId)) as any[]
            const customProps = get(customPropertiesByRevisionAtomFamily(revisionId)) as Record<
                string,
                any
            >
            const spec = get(appSchemaAtom)
            const routePath = get(appUriInfoAtom)?.routePath
            const requestBody = isChat
                ? toRequestBodyChat({
                      variant: variant as any,
                      prompts,
                      customProperties: customProps,
                      appType,
                      spec: spec as any,
                      routePath,
                      revisionId,
                      chatHistory: get(historyByRevisionAtomFamily(revisionId)) as any[],
                  })
                : toRequestBodyCompletion({
                      variant: variant as any,
                      prompts,
                      customProperties: customProps,
                      appType,
                      spec: spec as any,
                      routePath,
                  })
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
