/**
 * Prompt-related selectors and unified property facades
 * Scope: prompt-only reads and unified property access across prompts and generation data.
 */
import {atom} from "jotai"
import {atomFamily} from "jotai/utils"

import {promptsAtomFamily} from "@/oss/state/newPlayground/core/prompts"

import {findPropertyById, findPropertyInObject} from "../../hooks/usePlayground/assets/helpers"

import {updateVariantPropertyEnhancedMutationAtom} from "./propertyMutations"

/**
 * PROMPTS-ONLY READ/WRITE FACADE
 * `promptPropertyAtomFamily` provides a unified interface to read a prompt property value
 * for a given revision (variant revisionId) and write updates via the centralized mutation atom.
 * It does NOT touch generation data and serves as a simple facade over the prompts source of truth.
 */
export const promptPropertyAtomFamily = atomFamily(
    (params: {revisionId: string; propertyId: string}) =>
        atom(
            (get) => {
                const prompts = get(promptsAtomFamily(params.revisionId))
                const list = (prompts as any[]) || []
                const property =
                    findPropertyInObject(list, params.propertyId) ||
                    findPropertyById(list as any, params.propertyId)
                if (!property) return null
                return (property as any)?.content?.value || (property as any)?.value
            },
            (_get, set, nextValue: any) => {
                set(updateVariantPropertyEnhancedMutationAtom, {
                    variantId: params.revisionId,
                    propertyId: params.propertyId,
                    value: nextValue,
                })
            },
        ),
)
