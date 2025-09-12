/**
 * Prompt-related selectors and unified property facades
 * Scope: prompt-only reads and unified property access across prompts and generation data.
 */
import {atom} from "jotai"
import {atomFamily} from "jotai/utils"

import {getMetadataLazy} from "@/oss/lib/hooks/useStatelessVariants/state"
import {rowIdIndexAtom} from "@/oss/state/generation/entities"
import {chatTurnsByIdAtom} from "@/oss/state/generation/entities"
import {rowVariablesAtomFamily} from "@/oss/state/generation/selectors"
import {customPropertiesByRevisionAtomFamily} from "@/oss/state/newPlayground/core/customProperties"
import {promptsAtomFamily} from "@/oss/state/newPlayground/core/prompts"
import {appUriInfoAtom, getEnhancedRevisionById} from "@/oss/state/variant/atoms/fetcher"

import {findPropertyInObject} from "../../hooks/usePlayground/assets/helpers"
import {findPropertyById} from "../../hooks/usePlayground/middlewares/playgroundVariantMiddleware"

import {updateVariantPropertyEnhancedMutationAtom} from "./propertyMutations"
import {displayedVariantsAtom} from "./variants"

// Cache for synthesized string metadata to keep object identity stable across renders
const __syntheticStringMetadataCache = new Map<string, any>()
const getSyntheticStringMetadata = (propertyId: string) => {
    const key = `string:${propertyId}`
    if (__syntheticStringMetadataCache.has(key)) return __syntheticStringMetadataCache.get(key)
    const meta = {
        type: "string",
        title: propertyId,
        nullable: false,
        allowFreeform: true,
    }
    __syntheticStringMetadataCache.set(key, meta)
    return meta
}

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

/**
 * UNIFIED PROPERTY ATOM FAMILY
 * Handles both variant properties and generation data properties efficiently
 * Automatically determines the source (variant vs generation data) and provides optimized subscriptions
 */

export const unifiedPropertyValueAtomFamily = atomFamily(
    (params: {variantId?: string; propertyId: string; rowId?: string; messageId?: string}) =>
        atom((get) => {
            const {variantId: maybeVariantId, propertyId, rowId, messageId} = params

            // Resolve effective revision id for row-scoped variables when variantId is absent
            const effectiveRevisionId = (() => {
                if (maybeVariantId) return maybeVariantId
                if (rowId) {
                    const idx = get(rowIdIndexAtom)
                    if (idx?.[rowId]?.latestRevisionId) return idx[rowId].latestRevisionId as string
                }
                const displayed = get(displayedVariantsAtom) || []
                return displayed[0]
            })()

            // If rowId provided, prefer normalized generation inputs (row-scoped variables)
            if (rowId && effectiveRevisionId) {
                const vars = get(rowVariablesAtomFamily({rowId, revisionId: effectiveRevisionId}))
                // Match row-scoped variables by human-friendly key first, then fallback to __id
                const match = (vars || []).find((n: any) => (n?.key ?? n?.__id) === propertyId)
                if (match) {
                    return {
                        value: match?.content?.value ?? match?.value,
                        metadata: match?.__metadata,
                        source: "generationData" as const,
                        property: match,
                    }
                }
                // Also support normalized chat message properties (turns)
                const turns = get(chatTurnsByIdAtom) as any
                const turn = turns[rowId]
                if (turn) {
                    const candidates: any[] = []
                    if (turn.userMessage) candidates.push(turn.userMessage)
                    const assistant = turn.assistantMessageByRevision?.[effectiveRevisionId]
                    if (assistant) candidates.push(assistant)
                    for (const msg of candidates) {
                        const prop = findPropertyInObject(msg, propertyId)
                        if (prop) {
                            return {
                                value: (prop as any)?.content?.value ?? (prop as any)?.value,
                                metadata: (prop as any)?.__metadata,
                                source: "generationData" as const,
                                property: prop,
                            }
                        }
                    }
                }
                // If variable not present on row yet, return empty value to render control (created on first write)
                return {
                    value: "",
                    metadata: undefined,
                    source: "generationData" as const,
                    property: undefined as any,
                }
            }

            const revIdForPrompts = maybeVariantId || effectiveRevisionId
            if (revIdForPrompts) {
                const prompts = get(promptsAtomFamily(revIdForPrompts))
                const list = (prompts as any[]) || []
                const property =
                    findPropertyInObject(list, propertyId) ||
                    findPropertyById(list as any, propertyId)
                if (property) {
                    return {
                        value: (property as any)?.content?.value || (property as any)?.value,
                        metadata: (property as any)?.__metadata,
                        source: "variant" as const,
                        property,
                    }
                }

                // Fallback: try custom properties derived from OpenAPI spec
                const variant = getEnhancedRevisionById(get as any, revIdForPrompts)
                if (variant) {
                    const customProps = get(customPropertiesByRevisionAtomFamily(revIdForPrompts))
                    const values = Object.values(customProps || {}) as any[]
                    const node = values.find((n) => n?.__id === propertyId)
                    if (node) {
                        return {
                            value: (node as any)?.content?.value ?? (node as any)?.value,
                            metadata: (node as any)?.__metadata,
                            source: "variant", // treat as variant-sourced for read
                            property: node,
                        }
                    }
                }
            }

            return null
        }),
)

/**
 * UNIFIED PROPERTY METADATA ATOM FAMILY
 * Provides metadata for both variant and generation data properties
 */
export const unifiedPropertyMetadataAtomFamily = (params: {
    variantId?: string
    propertyId: string
    rowId?: string
    messageId?: string
}) => {
    return atom((get) => {
        const propertyData = get(unifiedPropertyValueAtomFamily(params))
        // Prefer metadata from propertyData; if absent, synthesize basic string metadata
        if (propertyData?.metadata) {
            return getMetadataLazy(propertyData.metadata)
        }

        // Synthesize metadata for dynamic variables not present in the row yet (stable identity)
        return getSyntheticStringMetadata(params.propertyId) as any
    })
}
