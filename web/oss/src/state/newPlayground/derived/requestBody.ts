import {atom} from "jotai"

import {
    toRequestBodyChat,
    toRequestBodyCompletion,
} from "@/oss/lib/shared/variant/transformer/transformToRequestBody"
import {currentAppContextAtom} from "@/oss/state/newApps/selectors/apps"
import {appSchemaAtom, appUriInfoAtom} from "@/oss/state/variant/atoms/fetcher"

import {historyByRevisionAtomFamily} from "../chat/history"
import {playgroundConfigAtom} from "../core/config"
import {customPropertiesByRevisionAtomFamily} from "../core/customProperties"
import {promptsAtomFamily} from "../core/prompts"
import {variantFlagsAtomFamily} from "../core/variantFlags"
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
