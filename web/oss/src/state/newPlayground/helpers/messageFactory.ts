import {getAllMetadata, getMetadataLazy} from "@agenta/entities/legacyAppRevision"
import {generateId} from "@agenta/shared/utils"

import {hashResponse} from "@/oss/components/Playground/assets/hash"
import {createMessageFromSchema} from "@/oss/components/Playground/hooks/usePlayground/assets/messageHelpers"

export function buildAssistantMessage(messageSchema: any | undefined, testResult: any) {
    // If we have a schema (from user message or generic), build via schema helper
    if (messageSchema) {
        if (testResult?.error) {
            const tree = testResult?.metadata?.rawError?.detail?.tree
            const trace = tree?.nodes?.[0]
            const messageStr = trace?.status?.message ?? String(testResult.error)
            return createMessageFromSchema(messageSchema, {role: "Error", content: messageStr})
        }

        const raw = (testResult as any)?.response?.data
        const inner = raw && typeof raw === "object" ? ((raw as any).data ?? raw) : raw
        const content =
            inner && typeof inner === "object"
                ? ((inner as any).content ?? (inner as any).data)
                : undefined

        let finalText: string | undefined
        if (typeof content === "string") finalText = content
        else if (Array.isArray(content)) {
            const texts = content
                .map((p: any) =>
                    (p?.type?.value ?? p?.type) === "text"
                        ? (p?.text?.value ?? p?.text ?? "")
                        : undefined,
                )
                .filter(Boolean)
            finalText = texts.join("\n\n")
        }
        if (finalText) {
            const createdMsg = createMessageFromSchema(messageSchema, {
                role: "assistant",
                content: finalText,
            })
            return createdMsg
        }

        return createMessageFromSchema(messageSchema, inner)
    }

    const fallbackContent = testResult?.error
        ? String(testResult.error)
        : (testResult?.response?.data?.content ?? "")

    return {
        __id: generateId(),
        role: {value: testResult?.error ? "Error" : "assistant", __id: generateId()},
        content: {value: fallbackContent, __id: generateId()},
    }
}

export function buildToolMessages(messageSchema: any | undefined, testResult: any) {
    if (!messageSchema) return [] as any[]

    try {
        const raw = (testResult as any)?.response?.data
        if (!raw) return []
        const inner =
            raw && typeof raw === "object"
                ? (raw as any).data !== undefined
                    ? (raw as any).data
                    : raw
                : raw

        const toolCalls = (inner as any)?.tool_calls ?? (inner as any)?.toolCalls
        if (!Array.isArray(toolCalls) || toolCalls.length === 0) return []

        return toolCalls
            .map((toolCall: any, index: number) => {
                const name =
                    toolCall?.function?.name || toolCall?.name || `tool_${index + 1}` || undefined
                const toolCallId =
                    toolCall?.id || toolCall?.__id || toolCall?.tool_call_id || undefined

                const rawArgs = toolCall?.function?.arguments ?? toolCall?.arguments
                const rawResponse = toolCall?.response ?? toolCall?.output ?? toolCall?.content
                // pickValue kept for potential future use in content field
                const _pickValue = rawResponse !== undefined ? rawResponse : rawArgs
                void _pickValue

                return createMessageFromSchema(messageSchema, {
                    role: "tool",
                    name,
                    toolCallId,
                    content: "",
                })
            })
            .filter(Boolean)
    } catch {
        return []
    }
}

// Build a user message node using a schema if available; otherwise fallback to minimal shape
export function buildUserMessage(
    messageSchema: any | undefined,
    init?: {role?: string; content?: any},
) {
    const role = init?.role ?? "user"
    const content = init?.content ?? ""

    // Fallback: discover a generic Message schema like synthesizeTurn
    if (!messageSchema) {
        try {
            const all = getAllMetadata()
            const entries = Object.entries(all as Record<string, any>)
            const found = entries.find(([, v]) => v?.title === "Message" && v?.type === "object")
            const messageMetaId = found?.[0]
            if (messageMetaId) messageSchema = getMetadataLazy(messageMetaId)
        } catch {
            // getAllMetadata not available yet
        }
    }

    if (messageSchema) {
        const createdMessage = createMessageFromSchema(messageSchema, {role, content})
        return createdMessage
    }

    // Minimal fallback
    return {
        __id: generateId(),
        role: {__id: generateId(), value: role},
        content: {__id: generateId(), value: content},
    }
}

export function buildCompletionResponseText(testResult: any): string {
    let normalized = testResult
    try {
        if (testResult?.error) {
            const tree = testResult?.metadata?.rawError?.detail?.tree
            const trace = tree?.nodes?.[0]
            const messageStr = trace?.status?.message ?? String(testResult.error)
            normalized = {
                response: {data: messageStr, tree},
                error: messageStr,
                metadata: testResult?.metadata,
            }
        }
    } catch {}
    return hashResponse(normalized)
}
