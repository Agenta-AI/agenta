/**
 * Message Factory
 *
 * Functions that convert execution results, testset data, and user input
 * into SimpleChatMessage objects (standard OpenAI/Anthropic format).
 *
 * No schema-driven wrapping — messages are plain data.
 */

import type {SimpleChatMessage} from "@agenta/shared/types"
import {generateId} from "@agenta/shared/utils"

const asRecord = (value: unknown): Record<string, unknown> | null => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null
    return value as Record<string, unknown>
}

const unwrapValue = (value: unknown): unknown => {
    const rec = asRecord(value)
    return rec && "value" in rec ? rec.value : value
}

const unwrapArray = (value: unknown): unknown[] | undefined => {
    if (Array.isArray(value)) return value
    const unwrapped = unwrapValue(value)
    return Array.isArray(unwrapped) ? unwrapped : undefined
}

const unwrapRecord = (value: unknown): Record<string, unknown> | null => {
    return asRecord(unwrapValue(value))
}

/**
 * Extract a plain string value from a potentially PropertyNode-wrapped value.
 * Handles both `"text"` and `{value: "text"}` shapes for backward compat
 * with API responses that may still carry wrapped values.
 */
const unwrapString = (value: unknown): string | undefined => {
    if (typeof value === "string") return value
    const rec = asRecord(value)
    if (rec && typeof rec.value === "string") return rec.value
    return undefined
}

export function buildAssistantMessage(testResult: unknown): SimpleChatMessage {
    const resultRecord = asRecord(testResult)

    if (resultRecord?.error) {
        const metadata = asRecord(resultRecord.metadata)
        const rawError = asRecord(metadata?.rawError)
        const detail = asRecord(rawError?.detail)
        const tree = asRecord(detail?.tree)
        const nodes = Array.isArray(tree?.nodes) ? tree?.nodes : []
        const trace = nodes.length > 0 ? asRecord(nodes[0]) : null
        const status = asRecord(trace?.status)
        const messageStr = (status?.message as string | undefined) ?? String(resultRecord.error)
        return {
            id: generateId(),
            role: "Error",
            content: messageStr,
        }
    }

    const response = asRecord(resultRecord?.response)
    const raw = response?.data
    const rawRec = asRecord(raw)
    const inner = rawRec ? (rawRec.data ?? rawRec) : raw
    const innerRec = asRecord(inner)
    const content = innerRec ? (innerRec.content ?? innerRec.data) : undefined

    // Preserve tool_calls so subsequent tool messages have a valid predecessor
    const toolCalls = innerRec?.tool_calls ?? innerRec?.toolCalls
    const toolCallsArr = unwrapArray(toolCalls)
    const normalizedToolCalls = toolCallsArr && toolCallsArr.length > 0 ? toolCallsArr : undefined

    let finalText: string | undefined
    if (typeof content === "string") {
        finalText = content
    } else if (Array.isArray(content)) {
        const texts = content
            .map((part) => {
                const partRec = asRecord(part)
                const type = unwrapString(partRec?.type)
                if (type !== "text") return undefined
                return unwrapString(partRec?.text) ?? ""
            })
            .filter(Boolean)
        finalText = texts.join("\n\n")
    }

    if (finalText !== undefined) {
        const msg: SimpleChatMessage = {
            id: generateId(),
            role: "assistant",
            content: finalText,
        }
        if (normalizedToolCalls) msg.tool_calls = normalizedToolCalls
        return msg
    }

    // Fallback: try to extract content from inner object
    const fallbackContent = innerRec
        ? (unwrapString(innerRec.content) ?? unwrapString(innerRec.data)) || ""
        : ""

    const msg: SimpleChatMessage = {
        id: generateId(),
        role: "assistant",
        content: fallbackContent,
    }
    if (normalizedToolCalls) msg.tool_calls = normalizedToolCalls
    return msg
}

export function buildToolMessages(testResult: unknown): SimpleChatMessage[] {
    try {
        const resultRec = asRecord(testResult)
        const responseRec = asRecord(resultRec?.response)
        const raw = responseRec?.data
        if (!raw) return []
        const rawRec = asRecord(raw)
        const inner = rawRec && rawRec.data !== undefined ? unwrapValue(rawRec.data) : raw
        const innerRec = asRecord(inner)

        const toolCalls = innerRec?.tool_calls ?? innerRec?.toolCalls
        const toolCallsArray = unwrapArray(toolCalls)
        if (!toolCallsArray || toolCallsArray.length === 0) return []

        return toolCallsArray
            .map((toolCall, index: number): SimpleChatMessage | null => {
                const toolCallRec = unwrapRecord(toolCall)
                const functionRec = unwrapRecord(toolCallRec?.function)
                const functionCallRec = unwrapRecord(toolCallRec?.function_call)
                const name =
                    unwrapString(functionRec?.name) ||
                    unwrapString(toolCallRec?.name) ||
                    `tool_${index + 1}`
                const toolCallId =
                    unwrapString(toolCallRec?.id) ||
                    unwrapString(toolCallRec?.__id) ||
                    unwrapString(toolCallRec?.tool_call_id) ||
                    unwrapString(toolCallRec?.toolCallId) ||
                    unwrapString(toolCallRec?.toolCallID) ||
                    unwrapString(functionCallRec?.id)

                return {
                    id: generateId(),
                    role: "tool",
                    name,
                    tool_call_id: toolCallId,
                    content: "",
                }
            })
            .filter((msg): msg is SimpleChatMessage => msg !== null)
    } catch {
        return []
    }
}

export function buildUserMessage(init?: {role?: string; content?: unknown}): SimpleChatMessage {
    const role = init?.role ?? "user"
    const content = init?.content ?? ""

    return {
        id: generateId(),
        role,
        content: typeof content === "string" ? content : "",
    }
}
