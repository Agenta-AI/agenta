/**
 * Message Factory
 *
 * Functions that convert execution results, testset data, and user input
 * into SimpleChatMessage objects (standard OpenAI/Anthropic format).
 *
 * No schema-driven wrapping — messages are plain data.
 */

import type {SimpleChatMessage, ToolCall} from "@agenta/shared/types"
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

const isToolCall = (value: unknown): value is ToolCall => {
    const rec = asRecord(value)
    const fn = asRecord(rec?.function)
    return (
        typeof rec?.id === "string" &&
        rec.type === "function" &&
        typeof fn?.name === "string" &&
        typeof fn?.arguments === "string"
    )
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
    const innerRec = asRecord(inner) || resultRecord

    const role = unwrapString(innerRec?.role) ?? "assistant"
    const content = innerRec ? (innerRec.content ?? innerRec.data) : undefined

    // Preserve tool_calls so subsequent tool messages have a valid predecessor
    const toolCalls = innerRec?.tool_calls ?? innerRec?.toolCalls
    const toolCallsArr = unwrapArray(toolCalls)
    const normalizedToolCalls = toolCallsArr?.filter(isToolCall)

    const toolCallId = unwrapString(innerRec?.tool_call_id ?? innerRec?.toolCallId)
    const name = unwrapString(innerRec?.name)

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

    const fallbackContent =
        finalText ??
        (innerRec ? (unwrapString(innerRec.content) ?? unwrapString(innerRec.data)) : "") ??
        ""

    const msg: SimpleChatMessage = {
        id: generateId(),
        role,
        content: fallbackContent,
    }

    if (normalizedToolCalls && normalizedToolCalls.length > 0) {
        msg.tool_calls = normalizedToolCalls
    }
    if (toolCallId) msg.tool_call_id = toolCallId
    if (name) msg.name = name

    return msg
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
