import {current, produce} from "immer"
import {atom} from "jotai"

import {updateVariantPromptKeys} from "@/oss/lib/shared/variant/inputHelpers"
import {generateId} from "@/oss/lib/shared/variant/stringUtils"
import {deriveCustomPropertiesFromSpec} from "@/oss/lib/shared/variant/transformer/transformer"
import {inputRowsByIdAtom, rowIdIndexAtom, chatTurnsByIdAtom} from "@/oss/state/generation/entities"
import {customPropertiesAtomFamily} from "@/oss/state/newPlayground/core/customProperties"
import {promptsAtomFamily} from "@/oss/state/newPlayground/core/prompts"
import {promptVariablesAtomFamily} from "@/oss/state/newPlayground/core/prompts"
import {variantFlagsAtomFamily} from "@/oss/state/newPlayground/core/variantFlags"
import {
    appUriInfoAtom,
    getEnhancedRevisionById,
    getSpecLazy,
} from "@/oss/state/variant/atoms/fetcher"

import {revisionListAtom} from "../../../../state/variant/selectors/variant"
import {findPropertyById, findPropertyInObject} from "../../hooks/usePlayground/assets/helpers"
import type {EnhancedVariantPropertyMutationParams, ConfigValue} from "../types"

import {selectedVariantsAtom} from "./core"
import {displayedVariantsAtom, schemaInputKeysAtom} from "./variants"

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
        if (property && typeof property === "object" && "value" in property) {
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
                (current: Record<string, any> | null) => {
                    // Seed from derived spec if local cache is empty
                    let next = current
                    if (!next || Object.keys(next).length === 0) {
                        if (variant && spec) {
                            next = deriveCustomPropertiesFromSpec(
                                variant as any,
                                spec as any,
                                routePath,
                            )
                            if (process.env.NODE_ENV === "development") {
                                console.debug("[Params][Mut] seeded from spec", {
                                    keys: Object.keys(next || {}),
                                })
                            }
                        } else {
                            next = {}
                        }
                    } else {
                        next = {...next}
                    }
                    const values = Object.values(next) as any[]
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
                    return next
                },
            )
        }
    },
)

// Helper function to update generation data regardless of source
const updateGenerationDataHelper = (
    generationData: any,
    _rowId: string,
    _messageId: string | undefined,
    _propertyId: string,
    _value: any,
) => {
    if (!generationData) {
        console.warn("No generation data found")
        return
    }

    if (_messageId) {
        // For chat mode with specific message updates
        if (generationData.messages?.value) {
            // Messages are nested inside message rows -> history.value array
            let targetMessage = null
            let _targetMessageRow = null

            // Search through all message rows and their history
            for (const messageRow of generationData.messages.value) {
                if (messageRow.history?.value) {
                    const foundMessage = messageRow.history.value.find(
                        (msg: any) => msg.__id === _messageId,
                    )
                    if (foundMessage) {
                        targetMessage = foundMessage
                        _targetMessageRow = messageRow
                        break
                    }
                }
            }

            if (targetMessage) {
                // Use findPropertyInObject for messages, not findPropertyById (which is for variants)
                const property = findPropertyInObject(targetMessage, _propertyId)

                if (property) {
                    updatePropertyValue(property, _value)
                }
            }
        } else if (generationData.history?.value) {
            // Try looking in history instead
            const targetMessage = generationData.history.value.find(
                (msg: any) => msg.__id === _messageId,
            )

            const property = findPropertyById(targetMessage, _propertyId)
            if (property) {
                updatePropertyValue(property, _value)
            }
        } else {
            // Fallback: Try to find the property directly in the generation data

            const property = findPropertyInObject(generationData, _propertyId)
            if (property) {
                updatePropertyValue(property, _value)
            }
        }
    } else {
        // For completion mode or general row updates

        // Search in all generation data structures (both inputs and messages)
        let targetRow: any = null
        let _foundInStructure = ""

        // First try to find by row ID in both structures
        if (generationData.messages?.value) {
            targetRow = generationData.messages.value.find((row: any) => row.__id === _rowId)
            if (targetRow) {
                _foundInStructure = "messages"
            }
        }

        if (!targetRow && generationData.inputs?.value) {
            targetRow = generationData.inputs.value.find((row: any) => row.__id === _rowId)
            if (targetRow) _foundInStructure = "inputs"
        }

        // Fallback: Search by property content in all structures
        if (!targetRow) {
            // Search in messages
            if (generationData.messages?.value) {
                for (const row of generationData.messages.value) {
                    if (findPropertyInObject(row, _propertyId)) {
                        targetRow = row
                        _foundInStructure = "messages"

                        break
                    }
                }
            }

            // Search in inputs if not found in messages
            if (!targetRow && generationData.inputs?.value) {
                for (const row of generationData.inputs.value) {
                    if (findPropertyInObject(row, _propertyId)) {
                        targetRow = row
                        _foundInStructure = "inputs"

                        break
                    }
                }
            }
        }

        if (!targetRow) {
            console.warn("Target row not found in any generation data structure:", {
                _rowId,
                _propertyId,
                availableMessageIds:
                    generationData.messages?.value?.map((row: any) => row.__id) || [],
                availableInputIds: generationData.inputs?.value?.map((row: any) => row.__id) || [],
            })
            return
        }

        // Try to find and update the property directly in the target row
        let property = findPropertyInObject(targetRow, _propertyId)
        if (property) {
            updatePropertyValue(property, _value)
        } else if (_foundInStructure === "inputs") {
            // Create missing variable on input row dynamically
            if (!targetRow[_propertyId]) {
                targetRow[_propertyId] = {
                    __id: generateId(),
                    __metadata: {
                        type: "string",
                        title: _propertyId,
                        description: `Template variable: {{${_propertyId}}}`,
                    },
                    value: _value,
                }
            } else {
                targetRow[_propertyId].value = _value
            }
        }
    }
}
