import {atom} from "jotai"
import {atomFamily} from "jotai/utils"
import {v4 as uuidv4} from "uuid"

import {hashMetadata} from "@/oss/components/Playground/assets/hash"
import {createMessageFromSchema} from "@/oss/components/Playground/hooks/usePlayground/assets/messageHelpers"
import {getMetadataLazy} from "@/oss/lib/hooks/useStatelessVariants/state"
import {ArrayMetadata} from "@/oss/lib/shared/variant/genericTransformer/types"
import {promptsAtomFamily} from "@/oss/state/newPlayground/core/prompts"

// Add a new message for a prompt identified by `${revisionId}:${promptId}`
export const addPromptMessageMutationAtomFamily = atomFamily((compoundKey: string) =>
    atom(null, (get, set) => {
        const [revisionId, promptId] = compoundKey.split(":", 2)
        // const revisions = get(revisionListAtom) || []
        // const variant = revisions.find((r: any) => r.id === revisionId)
        const prompts = get(promptsAtomFamily(revisionId)) as any[]
        const prompt = (prompts || []).find(
            (p: any) => p?.__id === promptId || p?.__name === promptId,
        )
        const messagesMetadataId = prompt?.messages?.__metadata as string | undefined
        if (!messagesMetadataId) return

        const parentMetadata = getMetadataLazy<ArrayMetadata>(messagesMetadataId)
        const metadata = parentMetadata?.itemMetadata
        if (!metadata) return

        const newMessage = createMessageFromSchema(metadata, {role: "", content: ""})
        if (!newMessage) return

        set(promptsAtomFamily(revisionId), (prev: any[]) => {
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
        })
    }),
)

// Delete a message by id for a prompt identified by `${revisionId}:${promptId}`
export const deletePromptMessageMutationAtomFamily = atomFamily((compoundKey: string) =>
    atom(null, (get, set, params: {messageId: string}) => {
        const [revisionId, promptId] = compoundKey.split(":", 2)
        const {messageId} = params || ({} as any)
        if (!messageId) return

        // const revisions = get(revisionListAtom) || []
        // const variant = revisions.find((r: any) => r.id === revisionId)
        const prompts = get(promptsAtomFamily(revisionId)) as any[]
        const prompt = (prompts || []).find(
            (p: any) => p?.__id === promptId || p?.__name === promptId,
        )
        if (!prompt?.messages) return
        set(promptsAtomFamily(revisionId), (prev: any[]) => {
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
        })
    }),
)

// Add a tool for a prompt identified by `${revisionId}:${promptId}`
export const addPromptToolMutationAtomFamily = atomFamily((compoundKey: string) =>
    atom(null, (get, set, payload?: Record<string, any>) => {
        const [revisionId, promptId] = compoundKey.split(":", 2)
        const newTool = {
            __id: uuidv4(),
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

        // const revisions = get(revisionListAtom) || []
        // const variant = revisions.find((r: any) => r.id === revisionId)
        set(promptsAtomFamily(revisionId), (prev: any[]) => {
            const list = Array.isArray(prev) ? prev : []
            const next = list.map((p: any) => {
                if (!(p?.__id === promptId || p?.__name === promptId)) return p
                const currentTools = p?.llmConfig?.tools?.value || []
                return {
                    ...p,
                    llmConfig: {
                        ...p.llmConfig,
                        tools: {
                            ...p.llmConfig?.tools,
                            value: [...currentTools, newTool],
                        },
                    },
                }
            })
            return next
        })
    }),
)
