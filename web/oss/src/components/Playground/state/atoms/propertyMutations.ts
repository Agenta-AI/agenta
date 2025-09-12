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
import {findPropertyInObject} from "../../hooks/usePlayground/assets/helpers"
import {findPropertyById} from "../../hooks/usePlayground/middlewares/playgroundVariantMiddleware"
import type {EnhancedVariantPropertyMutationParams, ConfigValue} from "../types"

import {playgroundStateAtom, selectedVariantsAtom, generationInputsDirtyAtom} from "./core"
import {forceSyncPromptVariablesToNormalizedAtom} from "./generationMutations"
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
        // Entry log to verify UI dispatch path
        console.log("[Params][Mut][ENTRY]", {
            rawEvent: event,
            propertyId,
            variantId,
            fallbackVariantId,
            fallbackPropertyId,
        })

        // Extract value from event or use direct value
        const value =
            event && typeof event === "object" && "target" in event ? event.target.value : event

        // Use provided IDs or fallback to defaults
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
            try {
                updateVariantPromptKeys(draft)
            } catch {
                /* optional */
            }
        }

        // First call ensures local prompts are seeded if absent
        set(promptsAtomFamily(targetRevisionId), (draft: any) => {
            tryUpdate(draft)
            if (didUpdate && process.env.NODE_ENV === "development") {
                console.debug("[Prompts][Mut] updated node", {propertyId, value})
            }
            if (didUpdate) {
                // Ensure variables sync reflects the edited prompts immediately
                // Defer one tick so promptVariablesAtomFamily sees latest prompts
                set(forceSyncPromptVariablesToNormalizedAtom)
            }
        })

        // If the property wasn't found during seeding, try once more against the freshly seeded cache
        if (!didUpdate) {
            set(promptsAtomFamily(targetRevisionId), (draft: any) => {
                tryUpdate(draft)
                if (didUpdate && process.env.NODE_ENV === "development") {
                    console.debug("[Prompts][Mut] updated node (2)", {propertyId, value})
                }
                if (didUpdate) {
                    set(forceSyncPromptVariablesToNormalizedAtom)
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

/**
 * Enhanced mutation for generation data properties (test runs, inputs, messages)
 * Handles updates to properties within generation data context
 */
export const updateGenerationDataPropertyMutationAtom = atom(
    null,
    (
        get,
        set,
        params: {
            rowId: string
            propertyId: string
            value: ConfigValue
            messageId?: string // For message-specific updates
            revisionId?: string // Target revision for comparison mode
        },
    ) => {
        const {
            rowId: _rowId,
            propertyId: _propertyId,
            value: _value,
            messageId: _messageId,
            revisionId: _revisionId,
        } = params

        // Helper: per-revision required variable set (prompts for non-custom; schema for custom)
        const getRequiredSet = (revId: string): Set<string> => {
            try {
                const flags = get(variantFlagsAtomFamily({revisionId: revId})) as any
                const isCustom = !!flags?.isCustom
                if (isCustom) {
                    const keys = (get(schemaInputKeysAtom) || []) as string[]
                    return new Set(keys)
                }
                const vars = (get(promptVariablesAtomFamily(revId)) || []) as string[]
                return new Set(vars)
            } catch {
                return new Set<string>()
            }
        }

        // First, try to update normalized row variables (preferred path)
        const normRows = get(inputRowsByIdAtom)
        const normRow = normRows[_rowId]
        if (normRow && !_messageId) {
            const rowIndex = get(rowIdIndexAtom)
            const displayed = (get(displayedVariantsAtom) as string[]) || []
            // Targets: explicit revisionId, otherwise all displayed (comparison), otherwise latest/first
            let targetRevIds: string[] = []
            if (_revisionId) {
                targetRevIds = [_revisionId]
            } else if (Array.isArray(displayed) && displayed.length > 1) {
                targetRevIds = displayed
            } else {
                const fallback = rowIndex?.[_rowId]?.latestRevisionId || displayed?.[0]
                if (fallback) targetRevIds = [fallback]
            }

            if (targetRevIds.length > 0) {
                const nextRow = {
                    ...normRow,
                    variablesByRevision: {...(normRow.variablesByRevision || {})},
                }
                for (const revId of targetRevIds) {
                    const required = getRequiredSet(revId)
                    // If property is not required for this revision, ensure it is not created/updated
                    const allow = required.has(_propertyId)
                    const existingNodes = ((nextRow.variablesByRevision as any)?.[revId] ||
                        []) as any[]
                    const i = existingNodes.findIndex((n) => (n?.key ?? n?.__id) === _propertyId)
                    const updatedNodes = [...existingNodes]
                    if (!allow) {
                        // Remove lingering node if present
                        if (i >= 0) {
                            updatedNodes.splice(i, 1)
                        }
                    } else if (i >= 0) {
                        // Guard: do not overwrite a non-empty seeded value with an empty initialization write
                        const prevVal = updatedNodes[i]?.content?.value ?? updatedNodes[i]?.value
                        const incomingEmpty =
                            _value === "" || _value === null || _value === undefined
                        const prevNonEmpty =
                            prevVal !== undefined && prevVal !== null && String(prevVal) !== ""
                        if (!(incomingEmpty && prevNonEmpty)) {
                            updatedNodes[i] = {
                                ...updatedNodes[i],
                                value: _value,
                                content: {...(updatedNodes[i]?.content || {}), value: _value},
                            }
                        }
                    } else {
                        // Guard: avoid creating empty nodes on init; wait until user provides a value
                        const incomingEmpty =
                            _value === "" || _value === null || _value === undefined
                        if (!incomingEmpty) {
                            updatedNodes.push({
                                __id: generateId(),
                                key: _propertyId,
                                value: _value,
                                content: {value: _value},
                            })
                        }
                    }
                    ;(nextRow.variablesByRevision as any)[revId] = updatedNodes
                    if (process.env.NODE_ENV === "development" && allow) {
                        console.log("[GEN VAR WRITE] normalized", {
                            rowId: _rowId,
                            revisionId: revId,
                            propertyId: _propertyId,
                            value: _value,
                        })
                    }
                }
                set(inputRowsByIdAtom, {...normRows, [_rowId]: nextRow})
                return
            }
        }

        // Normalized chat turn write (message properties)
        const turns = get(chatTurnsByIdAtom) as any
        const turn = turns[_rowId]
        if (turn && _messageId) {
            const candidates: any[] = []
            if (turn.userMessage) candidates.push(turn.userMessage)
            const maybeAssistant = _revisionId && turn.assistantMessageByRevision?.[_revisionId]
            if (maybeAssistant) candidates.push(maybeAssistant)
            for (const msg of candidates) {
                const prop = findPropertyInObject(msg, _propertyId)
                if (prop) {
                    set(chatTurnsByIdAtom, (prev) =>
                        produce(prev, (draft: any) => {
                            const targetBase = _messageId?.endsWith("-assistant")
                                ? draft[_rowId]?.assistantMessageByRevision?.[_revisionId]
                                : draft[_rowId]?.userMessage
                            const target = findPropertyInObject(targetBase, _propertyId) as any
                            if (target) {
                                if (target.content && typeof target.content === "object") {
                                    target.content.value = _value as any
                                } else {
                                    target.value = _value as any
                                }
                            }
                        }),
                    )
                    return
                }
                // Fallback: if the property wasn't found via deep search, but this is the
                // message content id, update content.value directly so UI reflects immediately.
                if ((msg as any)?.content?.__id === _propertyId) {
                    set(chatTurnsByIdAtom, (prev) =>
                        produce(prev, (draft: any) => {
                            const base = _messageId?.endsWith("-assistant")
                                ? draft[_rowId]?.assistantMessageByRevision?.[_revisionId]
                                : draft[_rowId]?.userMessage
                            if (base?.content) {
                                base.content.value = _value as any
                            }
                        }),
                    )
                    return
                }
            }
        }

        // Fallback: Update legacy playgroundStateAtom for messages or when normalized path not applicable
        // Gate legacy writes by required variables to avoid recreating removed vars
        const selectedIds = get(displayedVariantsAtom) || []
        const revForLegacy = _revisionId || selectedIds[0]
        if (revForLegacy) {
            const required = getRequiredSet(revForLegacy)
            if (!required.has(_propertyId)) {
                return
            }
        }
        set(playgroundStateAtom, (prevState) =>
            produce(prevState, (draft) => {
                if (!draft.generationData) {
                    console.warn("No generation data found in playground state")
                    return
                }
                updateGenerationDataHelper(
                    draft.generationData,
                    _rowId,
                    _messageId,
                    _propertyId,
                    _value,
                )

                // Also mirror into scoped map by current revision id if available
                const selectedRevisionId =
                    (draft as any)?.metadata?.selectedVariantId ||
                    (get(selectedVariantsAtom) || [])[0]
                if (selectedRevisionId) {
                    draft.generationDataByRevision = draft.generationDataByRevision || {}
                    draft.generationDataByRevision[selectedRevisionId] = draft.generationData
                }

                // Also mirror into comparison-scoped cache (sorted selected ids)
                const selectedIds = get(selectedVariantsAtom) || []
                if (selectedIds.length > 0) {
                    const compareKey = [...selectedIds].sort().join("|")
                    ;(draft as any).generationDataByKey = (draft as any).generationDataByKey || {}
                    ;(draft as any).generationDataByKey[compareKey] = draft.generationData
                }
            }),
        )

        // Mark inputs as dirty for current selected revision to avoid overwrite on sync
        try {
            const fromMetadata = (get(playgroundStateAtom) as any)?.metadata?.selectedVariantId
            const fromSelection = (get(selectedVariantsAtom) || [])[0]
            const selectedRevisionId = fromMetadata || fromSelection
            if (selectedRevisionId) {
                set(generationInputsDirtyAtom, (prev) => ({...prev, [selectedRevisionId]: true}))
            }
        } catch (e) {
            if (process.env.NODE_ENV === "development") {
                console.error("[PG Mut] Failed to mark inputs dirty", e)
            }
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
                console.log("FOUND TARGET MSG")
                // Use findPropertyInObject for messages, not findPropertyById (which is for variants)
                const property = findPropertyInObject(targetMessage, _propertyId)

                if (property) {
                    updatePropertyValue(property, _value)
                    console.log("FOUND TARGET PROPERTY", current(targetMessage))
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
