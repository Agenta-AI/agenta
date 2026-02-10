import {getMetadataLazy, type ArrayMetadata} from "@agenta/entities/legacyAppRevision"
import {atom} from "jotai"
import {atomFamily} from "jotai/utils"
import {v4 as uuidv4} from "uuid"

import {hashMetadata} from "@/oss/components/Playground/assets/hash"
import {createMessageFromSchema} from "@/oss/components/Playground/hooks/usePlayground/assets/messageHelpers"
import {moleculeBackedPromptsAtomFamily} from "@/oss/state/newPlayground/legacyEntityBridge"

/** Split compoundKey into [revisionId, promptId] safely.
 *  promptId may contain colons (e.g. "prompt:prompt1"), so we only split on the first ":". */
function splitCompoundKey(compoundKey: string): [string, string] {
    const idx = compoundKey.indexOf(":")
    return [compoundKey.substring(0, idx), compoundKey.substring(idx + 1)]
}

// Add a new message for a prompt identified by `${revisionId}:${promptId}`
export const addPromptMessageMutationAtomFamily = atomFamily((compoundKey: string) =>
    atom(null, (get, set) => {
        const [revisionId, promptId] = splitCompoundKey(compoundKey)

        // Get prompts from molecule (single source of truth)
        const prompts = (get(moleculeBackedPromptsAtomFamily(revisionId)) as any[]) || []

        const prompt = (prompts || []).find(
            (p: any) => p?.__id === promptId || p?.__name === promptId,
        )
        const messagesMetadataId = prompt?.messages?.__metadata as string | undefined
        if (!messagesMetadataId) return

        const parentMetadata = getMetadataLazy<ArrayMetadata>(messagesMetadataId)
        const metadata = parentMetadata?.itemMetadata
        if (!metadata) return

        const newMessage = createMessageFromSchema(metadata, {role: "user", content: ""})
        if (!newMessage) return

        // Mutation recipe for molecule-backed prompts
        const mutatePrompts = (prev: any[]) => {
            const next = (prev || []).map((p: any) => {
                if (!(p?.__id === promptId || p?.__name === promptId)) return p
                const currentMessages = p?.messages?.value || []
                return {
                    ...p,
                    messages: {
                        ...p.messages,
                        value: [...currentMessages, newMessage],
                    },
                }
            })
            return next
        }

        // Update via molecule-backed prompts atom (single source of truth)
        set(moleculeBackedPromptsAtomFamily(revisionId), mutatePrompts)
    }),
)

// Delete a message by id for a prompt identified by `${revisionId}:${promptId}`
export const deletePromptMessageMutationAtomFamily = atomFamily((compoundKey: string) =>
    atom(null, (get, set, params: {messageId: string}) => {
        const [revisionId, promptId] = splitCompoundKey(compoundKey)
        const {messageId} = params || ({} as any)
        if (!messageId) return

        // Get prompts from molecule (single source of truth)
        const prompts = (get(moleculeBackedPromptsAtomFamily(revisionId)) as any[]) || []

        const prompt = (prompts || []).find(
            (p: any) => p?.__id === promptId || p?.__name === promptId,
        )
        if (!prompt?.messages) return

        // Mutation recipe for molecule-backed prompts
        const mutatePrompts = (prev: any[]) => {
            const next = (prev || []).map((p: any) => {
                if (!(p?.__id === promptId || p?.__name === promptId)) return p
                const currentMessages = p?.messages?.value || []
                const updatedMessages = currentMessages.filter((m: any) => m?.__id !== messageId)
                return {
                    ...p,
                    messages: {
                        ...p.messages,
                        value: updatedMessages,
                    },
                }
            })
            return next
        }

        // Update via molecule-backed prompts atom (single source of truth)
        set(moleculeBackedPromptsAtomFamily(revisionId), mutatePrompts)
    }),
)

// Add a tool for a prompt identified by `${revisionId}:${promptId}`
export const addPromptToolMutationAtomFamily = atomFamily((compoundKey: string) =>
    atom(
        null,
        (
            _get,
            set,
            params?: {
                payload?: Record<string, any>
                source?: "inline" | "builtin"
                providerKey?: string
                providerLabel?: string
                toolCode?: string
                toolLabel?: string
            },
        ) => {
            const [revisionId, promptId] = splitCompoundKey(compoundKey)

            const payload = params?.payload
            const source = params?.source ?? (payload ? "builtin" : "inline")
            const providerKey = params?.providerKey
            const providerLabel = params?.providerLabel
            const toolCode = params?.toolCode
            const toolLabel = params?.toolLabel
            const newTool = {
                __id: uuidv4(),
                __source: source,
                __provider: providerKey,
                __providerLabel: providerLabel,
                __tool: toolCode,
                __toolLabel: toolLabel,
                __metadata: hashMetadata({
                    type: "object",
                    name: "ToolConfiguration",
                    description: "Tool configuration",
                    properties: {
                        type: {
                            type: "string",
                            description: "Type of the tool",
                        },
                        name: {
                            type: "string",
                            description: "Name of the tool",
                        },
                        description: {
                            type: "string",
                            description: "Description of the tool",
                        },
                        parameters: {
                            type: "object",
                            properties: {
                                type: {
                                    type: "string",
                                    enum: ["object", "function"],
                                },
                            },
                        },
                    },
                    required: ["name", "description", "parameters"],
                }),
                value: payload || {
                    type: "function",
                    function: {
                        name: "get_weather",
                        description: "Get current temperature for a given location.",
                        parameters: {
                            type: "object",
                            properties: {
                                location: {
                                    type: "string",
                                    description: "City and country e.g. Bogotá, Colombia",
                                },
                            },
                            required: ["location"],
                            additionalProperties: false,
                        },
                    },
                },
            }

            // Mutation recipe for molecule-backed prompts
            const mutatePrompts = (prev: any[]) => {
                const list = Array.isArray(prev) ? prev : []
                const next = list.map((p: any) => {
                    if (!(p?.__id === promptId || p?.__name === promptId)) return p
                    // Use whichever key the prompt already has (entity uses llm_config,
                    // OSS transformer uses llmConfig). Writing to the wrong key
                    // creates a split that drops responseFormat.
                    const configKey = p?.llm_config ? "llm_config" : "llmConfig"
                    const llm = p?.[configKey] || {}
                    const currentTools = llm?.tools?.value || []
                    return {
                        ...p,
                        [configKey]: {
                            ...llm,
                            tools: {
                                ...llm?.tools,
                                value: [...currentTools, newTool],
                            },
                        },
                    }
                })
                return next
            }

            // Update via molecule-backed prompts atom (single source of truth)
            set(moleculeBackedPromptsAtomFamily(revisionId), mutatePrompts)
        },
    ),
)
