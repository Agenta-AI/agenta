/**
 * Prompt-related selectors and unified property facades
 * Scope: prompt-only reads and unified property access across prompts and generation data.
 *
 * ARCHITECTURE NOTE:
 * This module aligns with the new @agenta/playground pattern where property updates
 * route through the moleculePropertyUpdateAtom (single mutation path) instead of
 * directly mutating enhancedPrompts arrays at the component layer.
 */
import {atom} from "jotai"
import {atomFamily} from "jotai/utils"

import {
    moleculeBackedPromptsAtomFamily,
    moleculePropertyUpdateAtom,
} from "@/oss/state/newPlayground/legacyEntityBridge"

import {findPropertyById, findPropertyInObject} from "../../hooks/usePlayground/assets/helpers"

/**
 * PROMPTS-ONLY READ/WRITE FACADE
 *
 * Provides a unified interface to read/write prompt property values.
 *
 * READ: Finds property by __id in molecule-backed prompts
 * WRITE: Routes property updates through moleculePropertyUpdateAtom
 *        (single mutation path via legacyAppRevisionMolecule.reducers.updateProperty)
 */
export const promptPropertyAtomFamily = atomFamily(
    (params: {revisionId: string; propertyId: string}) =>
        atom(
            (get) => {
                // Use molecule-backed prompts for single source of truth
                const prompts = get(moleculeBackedPromptsAtomFamily(params.revisionId))
                const list = (prompts as any[]) || []
                const property =
                    findPropertyInObject(list, params.propertyId) ||
                    findPropertyById(list as any, params.propertyId)
                if (!property) return null
                return (property as any)?.content?.value || (property as any)?.value
            },
            (_get, set, nextValue: unknown) => {
                const {revisionId, propertyId} = params

                // Route through the centralized molecule update path
                set(moleculePropertyUpdateAtom, {
                    revisionId,
                    propertyId,
                    value: nextValue,
                })
            },
        ),
)
