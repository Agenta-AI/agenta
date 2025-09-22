import {atom} from "jotai"

import {updateVariantPromptKeys} from "@/oss/lib/shared/variant/inputHelpers"
import {deriveCustomPropertiesFromSpec} from "@/oss/lib/shared/variant/transformer/transformer"
import {customPropertiesAtomFamily} from "@/oss/state/newPlayground/core/customProperties"
import {promptsAtomFamily} from "@/oss/state/newPlayground/core/prompts"
import {
    appUriInfoAtom,
    getEnhancedRevisionById,
    getSpecLazy,
} from "@/oss/state/variant/atoms/fetcher"

import {revisionListAtom} from "../../../../state/variant/selectors/variant"
import {findPropertyById, findPropertyInObject} from "../../hooks/usePlayground/assets/helpers"
import type {EnhancedVariantPropertyMutationParams, ConfigValue} from "../types"

import {selectedVariantsAtom} from "./core"

// Re-export the type for external use
export type {ConfigValue} from "../types"

/**
 * Enhanced Variant Property Mutations
 *
 * These mutations properly handle nested property structures that we discovered
 * during the PromptMessageConfig migration, where property values can be stored
 * in nested structures like property.content.value instead of property.value
 */

/**
 * Helper function to update property value with proper nested structure handling
 */
function updatePropertyValue(property: any, value: ConfigValue) {
    if (!property) return

    // Handle nested property structures (e.g., property.content.value)
    if (property?.content && typeof property.content === "object" && "value" in property.content) {
        ;(property.content as any).value = value
    } else {
        // Direct property value assignment
        if (property && typeof property === "object") {
            ;(property as any).value = value
        }
    }
}

/**
 * Parameter update mutation with fallback handling
 * This atom handles parameter updates with proper fallback logic for missing IDs
 * Eliminates the need for React-level useCallback wrappers
 */
export const parameterUpdateMutationAtom = atom(
    null,
    (
        get,
        set,
        params: {
            event: {target: {value: any}} | any
            propertyId?: string
            variantId?: string
            fallbackVariantId?: string
            fallbackPropertyId?: string
        },
    ) => {
        const {event, propertyId, variantId, fallbackVariantId, fallbackPropertyId} = params
        const value =
            event && typeof event === "object" && "target" in event ? event.target.value : event

        const targetVariantId = variantId || fallbackVariantId
        const targetPropertyId = propertyId || fallbackPropertyId

        if (targetVariantId && targetPropertyId) {
            // Use the existing enhanced mutation directly
            set(updateVariantPropertyEnhancedMutationAtom, {
                variantId: targetVariantId,
                propertyId: targetPropertyId,
                value,
            })
        } else {
            console.warn("[Params][Mut][ENTRY] Missing IDs for parameter update", {
                targetVariantId,
                targetPropertyId,
            })
        }
    },
)

/**
 * Enhanced property update mutation that handles nested property structures
 * This mutation properly handles cases where property values are stored in
 * nested structures like property.content.value instead of property.value
 */
export const updateVariantPropertyEnhancedMutationAtom = atom(
    null,
    (get, set, params: EnhancedVariantPropertyMutationParams) => {
        const {variantId: rawVariantId, propertyId, value} = params

        // Handle case where variantId might be an object instead of string
        const variantId =
            typeof rawVariantId === "string" ? rawVariantId : (rawVariantId as any)?.id

        if (process.env.NODE_ENV === "development") {
            console.debug("[Params][Mut] start", {variantId, propertyId, value})
        }
        if (!variantId) {
            if (process.env.NODE_ENV === "development") {
                console.warn("No valid variantId provided:", rawVariantId)
            }
            return
        }

        // Resolve target revisionId for this update
        const revisions = get(revisionListAtom)

        // If provided id matches a revision id, use it directly; otherwise find latest/selected for the variant
        let targetRevisionId: string | null = null
        const idStr = String(variantId)
        const directMatch = revisions.find((r: any) => r.id === idStr)

        if (process.env.NODE_ENV === "development") {
            console.debug("[Params][Mut] directMatch", {directMatch: !!directMatch})
        }
        if (directMatch) {
            targetRevisionId = directMatch.id
            if (process.env.NODE_ENV === "development") {
                console.debug("[Params][Mut] use direct revision id", {targetRevisionId})
            }
        } else {
            // Try to find currently displayed/selected revision for this variant
            const selected = get(selectedVariantsAtom)
            const selectedMatch = revisions.find(
                (r: any) => selected.includes(r.id) && r.variantId === idStr,
            )
            if (process.env.NODE_ENV === "development") {
                console.debug("[Params][Mut] selectedMatch", {selectedMatch: !!selectedMatch})
            }
            if (selectedMatch) {
                targetRevisionId = selectedMatch.id
                if (process.env.NODE_ENV === "development") {
                    console.debug("[Params][Mut] selected revision id", {targetRevisionId})
                }
            } else {
                // Fallback to newest revision of the variant
                const newest = revisions
                    .filter((r: any) => r.variantId === idStr)
                    .sort((a: any, b: any) => b.updatedAtTimestamp - a.updatedAtTimestamp)[0]
                targetRevisionId = newest ? newest.id : null
                if (process.env.NODE_ENV === "development") {
                    console.debug("[Params][Mut] fallback newest revision", {targetRevisionId})
                }
            }
        }

        if (!targetRevisionId) {
            if (process.env.NODE_ENV === "development") {
                console.debug("[Params][Mut] no targetRevisionId resolved; abort")
            }
            if (process.env.NODE_ENV === "development") {
                console.warn("No target revision resolved for variant:", variantId)
            }
            return
        }

        // Provide an Immer recipe to leverage promptsAtomFamily seeding logic on first write
        let didUpdate = false
        const tryUpdate = (draft: any) => {
            // Prefer generic object search to handle prompt structures
            const prop =
                findPropertyInObject(draft ?? {}, propertyId) ??
                // Fallback: try variant-like search if shape matches
                findPropertyById(draft, propertyId)

            if (!prop) return

            updatePropertyValue(prop, value)
            didUpdate = true

            // Keep prompt keys up-to-date if the helper applies on this shape
            updateVariantPromptKeys(draft)
        }

        // First call ensures local prompts are seeded if absent
        set(promptsAtomFamily(targetRevisionId), (draft: any) => {
            tryUpdate(draft)
            if (didUpdate && process.env.NODE_ENV === "development") {
                console.debug("[Prompts][Mut] updated node", {propertyId, value})
            }
        })

        // If the property wasn't found during seeding, try once more against the freshly seeded cache
        if (!didUpdate) {
            set(promptsAtomFamily(targetRevisionId), (draft: any) => {
                tryUpdate(draft)
                if (didUpdate && process.env.NODE_ENV === "development") {
                    console.debug("[Prompts][Mut] updated node (2)", {propertyId, value})
                }
            })
        }

        // If still not updated (not a prompt), try custom properties local cache
        if (!didUpdate) {
            const variant = getEnhancedRevisionById(get as any, targetRevisionId)
            const routePath = get(appUriInfoAtom)?.routePath
            const spec = getSpecLazy()
            if (process.env.NODE_ENV === "development") {
                console.debug("[Params][Mut] try custom props", {
                    targetRevisionId,
                    hasVariant: !!variant,
                    hasSpec: !!spec,
                    routePath,
                })
            }
            set(
                customPropertiesAtomFamily({
                    variant: variant as any,
                    routePath,
                    revisionId: targetRevisionId,
                }),
                (draft: Record<string, any> | undefined) => {
                    // Seed from derived spec if local cache is empty
                    if (!draft || Object.keys(draft).length === 0) {
                        const seeded =
                            variant && spec
                                ? deriveCustomPropertiesFromSpec(
                                      variant as any,
                                      spec as any,
                                      routePath,
                                  )
                                : {}
                        if (process.env.NODE_ENV === "development") {
                            console.debug("[Params][Mut] seeded from spec", {
                                keys: Object.keys(seeded || {}),
                            })
                        }

                        if (!draft) {
                            draft = seeded
                        } else {
                            Object.keys(draft).forEach((key) => delete draft[key])
                            Object.assign(draft, seeded)
                        }
                    }

                    const values = Object.values(draft || {}) as any[]
                    const node = values.find((n) => n?.__id === propertyId)
                    if (process.env.NODE_ENV === "development") {
                        console.debug("[Params][Mut] node lookup", {
                            found: !!node,
                            propertyId,
                            total: values.length,
                        })
                    }
                    if (node) {
                        updatePropertyValue(node, value)
                        didUpdate = true
                        if (process.env.NODE_ENV === "development") {
                            console.debug("[CustomProps][Mut] updated node", {
                                propertyId,
                                value,
                            })
                        }
                    }
                    return draft
                },
            )
        }
    },
)
