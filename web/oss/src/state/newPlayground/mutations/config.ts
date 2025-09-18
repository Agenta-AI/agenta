import {produce} from "immer"
import {atom} from "jotai"

import {playgroundConfigAtom, updateVariantConfigAtom} from "../core/config"
import type {UpdateConfigParams} from "../types"

/**
 * Config Mutation Atoms
 *
 * These atoms handle direct configuration updates without sync overhead.
 * Clean, optimized mutations for variant prompts and parameters.
 */

// Update variant prompt property
export const updateVariantPromptAtom = atom(
    null,
    (
        get,
        set,
        params: {
            variantId: string
            propertyId: string
            value: any
        },
    ) => {
        const {variantId, propertyId, value} = params

        // Update property by ID - delegates to generic property update
        set(updateVariantPropertyAtom, {
            variantId,
            propertyId,
            value,
        })
    },
)

// Update variant parameter
export const updateVariantParameterAtom = atom(
    null,
    (
        get,
        set,
        params: {
            variantId: string
            propertyId: string
            value: any
        },
    ) => {
        const {variantId, propertyId, value} = params

        // Update property by ID - delegates to generic property update
        set(updateVariantPropertyAtom, {
            variantId,
            propertyId,
            value,
        })
    },
)

// Update variant name
export const updateVariantNameAtom = atom(
    null,
    (
        get,
        set,
        params: {
            variantId: string
            name: string
        },
    ) => {
        const {variantId, name} = params

        set(updateVariantConfigAtom, {
            variantId,
            path: ["name"],
            value: name,
        })
    },
)

// Bulk update variant config
export const bulkUpdateVariantAtom = atom(
    null,
    (
        get,
        set,
        params: {
            variantId: string
            updates: {
                path: string[]
                value: any
            }[]
        },
    ) => {
        const {variantId, updates} = params

        set(
            playgroundConfigAtom,
            produce((draft) => {
                const variant = draft.variants[variantId]
                if (!variant) return

                // Apply all updates
                updates.forEach(({path, value}) => {
                    let target: any = variant
                    for (let i = 0; i < path.length - 1; i++) {
                        if (!target[path[i]]) target[path[i]] = {}
                        target = target[path[i]]
                    }
                    target[path[path.length - 1]] = value
                })

                variant.metadata.updatedAt = Date.now()
            }),
        )
    },
)

// Reset variant to original revision state
export const resetVariantAtom = atom(null, (get, set, variantId: string) => {
    // TODO: Implement reset to original revision
    // This would require access to the original revisions atom
    console.warn("resetVariantAtom not yet implemented - requires original revisions data")
})

// Duplicate variant configuration
export const duplicateVariantConfigAtom = atom(
    null,
    (
        get,
        set,
        params: {
            sourceVariantId: string
            targetVariantId: string
        },
    ) => {
        const {sourceVariantId, targetVariantId} = params
        const config = get(playgroundConfigAtom)
        const sourceVariant = config.variants[sourceVariantId]

        if (!sourceVariant) return

        set(
            playgroundConfigAtom,
            produce((draft) => {
                const targetVariant = draft.variants[targetVariantId]
                if (!targetVariant) return

                // Copy prompts and parameters
                targetVariant.prompts = structuredClone(sourceVariant.prompts)
                targetVariant.parameters = structuredClone(sourceVariant.parameters)
                targetVariant.isChatVariant = sourceVariant.isChatVariant
                targetVariant.metadata.updatedAt = Date.now()
            }),
        )
    },
)

// Generic property update (for complex nested updates)
export const updateVariantPropertyAtom = atom(null, (get, set, params: UpdateConfigParams) => {
    set(updateVariantConfigAtom, params)
})

// Purpose-specific mutation atoms for complex operations

// Add new message to prompt messages array
export const addPromptMessageAtom = atom(
    null,
    (
        get,
        set,
        params: {
            variantId: string
            promptId: string
            messageTemplate?: any // Optional template for new message
        },
    ) => {
        const {variantId, promptId, messageTemplate} = params
        const config = get(playgroundConfigAtom)
        const variant = config.variants[variantId]

        if (!variant) {
            console.warn("Cannot add message: variant not found")
            return
        }

        const prompt = variant.prompts.find((p) => p.__id === promptId)
        if (!prompt?.messages?.__id) {
            console.warn("Cannot add message: messages property ID not found")
            return
        }

        set(
            playgroundConfigAtom,
            produce((draft) => {
                const draftVariant = draft.variants[variantId]
                const draftPrompt = draftVariant.prompts.find((p) => p.__id === promptId)

                if (!draftPrompt) return

                const currentMessages = draftPrompt.messages.value || []

                // Use provided template or create default message structure
                const newMessage = messageTemplate || {
                    __id: crypto.randomUUID(),
                    __metadata: "default_message_metadata",
                    role: {value: "user", __id: crypto.randomUUID(), __metadata: "role_metadata"},
                    content: {value: "", __id: crypto.randomUUID(), __metadata: "content_metadata"},
                    name: {value: null, __id: crypto.randomUUID(), __metadata: "name_metadata"},
                    toolCalls: {
                        value: null,
                        __id: crypto.randomUUID(),
                        __metadata: "tool_calls_metadata",
                    },
                    toolCallId: {
                        value: null,
                        __id: crypto.randomUUID(),
                        __metadata: "tool_call_id_metadata",
                    },
                }

                draftPrompt.messages.value = [...currentMessages, newMessage]
                draftVariant.metadata.updatedAt = Date.now()
            }),
        )
    },
)

// Delete message from prompt messages array
export const deletePromptMessageAtom = atom(
    null,
    (
        get,
        set,
        params: {
            variantId: string
            promptId: string
            messageId: string
        },
    ) => {
        const {variantId, promptId, messageId} = params

        set(
            playgroundConfigAtom,
            produce((draft) => {
                const variant = draft.variants[variantId]
                if (!variant) return

                const prompt = variant.prompts.find((p) => p.__id === promptId)
                if (!prompt?.messages?.value) return

                // Filter out the message with the specified ID
                prompt.messages.value = prompt.messages.value.filter(
                    (message) => message.__id !== messageId,
                )

                variant.metadata.updatedAt = Date.now()
            }),
        )
    },
)

// Reorder messages in prompt messages array
export const reorderPromptMessagesAtom = atom(
    null,
    (
        get,
        set,
        params: {
            variantId: string
            promptId: string
            fromIndex: number
            toIndex: number
        },
    ) => {
        const {variantId, promptId, fromIndex, toIndex} = params

        set(
            playgroundConfigAtom,
            produce((draft) => {
                const variant = draft.variants[variantId]
                if (!variant) return

                const prompt = variant.prompts.find((p) => p.__id === promptId)
                if (!prompt?.messages?.value) return

                const messages = [...prompt.messages.value]
                const [movedMessage] = messages.splice(fromIndex, 1)
                messages.splice(toIndex, 0, movedMessage)

                prompt.messages.value = messages
                variant.metadata.updatedAt = Date.now()
            }),
        )
    },
)
