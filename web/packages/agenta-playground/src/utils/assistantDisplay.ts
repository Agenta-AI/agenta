/**
 * Pure utility functions for extracting display values from assistant messages
 * and execution results.
 *
 * These replace the old useAssistant hooks which wrapped pure derivation
 * logic in useMemo. The pure functions can be used in both React and
 * non-React contexts.
 */

import {asRecord, safeStringify} from "@agenta/shared/utils"

// ============================================================================
// TEXT EXTRACTION (inlined from deleted messageContent.ts)
// ============================================================================

const getNodeType = (part: unknown): string | undefined => {
    const partRec = asRecord(part)
    if (!partRec) return undefined
    const typeRec = asRecord(partRec.type)
    return (typeRec?.value ?? partRec.type) as string | undefined
}

function getTextContent(content: unknown): string {
    if (typeof content === "string") return content
    if (Array.isArray(content)) {
        const value = content.filter((part) => getNodeType(part) === "text")
        return value.length > 0
            ? (() => {
                  const first = asRecord(value[0])
                  const text = first?.text
                  if (typeof text === "string") return text
                  const textRec = asRecord(text)
                  return (textRec?.value as string | undefined) ?? ""
              })()
            : ""
    }
    return ""
}

// ============================================================================
// TYPES
// ============================================================================

export interface ToolCallView {
    title: string | undefined
    json: string
}

// ============================================================================
// ASSISTANT DISPLAY VALUE
// ============================================================================

function formatToolCall(toolCall: unknown): string {
    const toolCallRec = asRecord(toolCall)
    const functionRec = asRecord(toolCallRec?.function)
    const name =
        (functionRec?.name as string | undefined) ||
        (toolCallRec?.name as string | undefined) ||
        "tool_1"
    const argsRaw = functionRec?.arguments ?? toolCallRec?.arguments ?? {}
    const argsStr = typeof argsRaw === "string" ? argsRaw : safeStringify(argsRaw)
    return `Tool call: ${name} \n${argsStr}`
}

function formatFunctionCall(functionCall: unknown): string {
    const functionRec = asRecord(functionCall)
    const name = (functionRec?.name as string | undefined) || "function"
    const args = functionRec?.arguments || {}
    const argsStr = typeof args === "string" ? args : safeStringify(args)
    return `Function call: ${name} \n${argsStr}`
}

/**
 * Extract a displayable string from an assistant message and/or execution result.
 *
 * Handles:
 * - Direct string content
 * - Array content with text nodes
 * - Nested value objects
 * - Tool calls and function calls from results
 * - Raw JSON fallback
 */
export function extractAssistantDisplayValue(
    assistantContent: unknown,
    result: unknown,
): string | undefined {
    // Try direct content first
    const direct = assistantContent
    if (Array.isArray(direct)) return getTextContent(direct)
    if (typeof direct === "string" && direct.length > 0) return direct
    if (direct && typeof direct === "object" && "value" in direct) {
        const directRec = asRecord(direct)
        const v = directRec?.value
        if (Array.isArray(v)) return getTextContent(v)
        if (typeof v === "string") return v
    }

    // Try result data
    const resultRec = asRecord(result)
    const responseRec = asRecord(resultRec?.response)
    const raw = responseRec?.data
    if (raw === undefined || raw === null) return undefined

    if (typeof raw === "string") return raw
    if (typeof raw === "object") {
        const rawRec = asRecord(raw)
        const inner = rawRec?.data ?? raw
        const innerRec = asRecord(inner)
        const content = innerRec?.content ?? innerRec?.data
        if (typeof content === "string") return content
        if (Array.isArray(content)) return getTextContent(content)
        if (content && typeof content === "object" && "value" in content) {
            const contentRec = asRecord(content)
            return String(contentRec?.value ?? "")
        }

        const toolCalls = innerRec?.tool_calls
        const functionCall = innerRec?.function_call
        try {
            if (Array.isArray(toolCalls) && toolCalls.length > 0) {
                if (toolCalls.length === 1) return formatToolCall(toolCalls[0])
                return safeStringify(toolCalls)
            }
            if (functionCall && typeof functionCall === "object") {
                return formatFunctionCall(functionCall)
            }
        } catch {
            // ignore
        }
    }
    try {
        return JSON.stringify(raw)
    } catch {
        return String(raw ?? "")
    }
}

// ============================================================================
// TOOL CALLS VIEW
// ============================================================================

function parseArgs(argsRaw: unknown): string {
    if (typeof argsRaw === "string") {
        try {
            const parsed = JSON.parse(argsRaw)
            return JSON.stringify(parsed, null, 2)
        } catch {
            return argsRaw
        }
    }
    return safeStringify(argsRaw)
}

/**
 * Extract structured tool call information from an execution result.
 * Returns `{title, json}` for display, or undefined if no tool calls found.
 */
export function extractToolCallsView(result: unknown): ToolCallView | undefined {
    const resultRec = asRecord(result)
    const responseRec = asRecord(resultRec?.response)
    const raw = responseRec?.data
    if (!raw) return undefined
    const rawRec = asRecord(raw)
    const inner = typeof raw === "object" ? (rawRec?.data ?? raw) : raw
    const innerRec = asRecord(inner)
    const toolCalls = innerRec?.tool_calls
    const functionCall = innerRec?.function_call

    try {
        if (Array.isArray(toolCalls) && toolCalls.length > 0) {
            if (toolCalls.length === 1) {
                const toolCallRec = asRecord(toolCalls[0])
                const functionRec = asRecord(toolCallRec?.function)
                const name =
                    (functionRec?.name as string | undefined) ||
                    (toolCallRec?.name as string | undefined) ||
                    "tool_1"
                const argsRaw = functionRec?.arguments || toolCallRec?.arguments || {}
                return {title: `Tool call: ${name}`, json: parseArgs(argsRaw)}
            }
            return {title: undefined, json: JSON.stringify(toolCalls, null, 2)}
        }
        if (functionCall && typeof functionCall === "object") {
            const functionRec = asRecord(functionCall)
            const name = (functionRec?.name as string | undefined) || "function"
            const args = functionRec?.arguments || {}
            return {title: `Function call: ${name}`, json: parseArgs(args)}
        }
    } catch {
        // ignore
    }
    return undefined
}

// ============================================================================
// CONTENT CHECKS
// ============================================================================

/**
 * Check if an assistant message has any displayable content.
 */
export function hasAssistantContent(
    assistant: unknown,
    displayValue?: string | null,
    hasToolCallsOverride?: boolean,
): boolean {
    const txt = (displayValue || "").trim()
    const assistantRec = asRecord(assistant)
    const toolCallsCamel = assistantRec?.toolCalls
    const toolCallsCamelRec = asRecord(toolCallsCamel)
    const toolCallsCamelValue = toolCallsCamelRec?.value
    const hasTools = Boolean(
        assistantRec?.function_call ||
        assistantRec?.tool_call ||
        (Array.isArray(toolCallsCamel) && toolCallsCamel.length > 0) ||
        (Array.isArray(toolCallsCamelValue) && toolCallsCamelValue.length > 0) ||
        (Array.isArray(assistantRec?.tool_calls) && assistantRec.tool_calls.length > 0),
    )
    return Boolean(txt) || hasTools || Boolean(hasToolCallsOverride)
}

/**
 * Resolve an effective revision ID from an entity ID or a list of displayed entity IDs.
 */
export function resolveEffectiveRevisionId(
    entityId: string | undefined,
    displayedEntityIds: string[] | undefined,
): string {
    if (entityId && typeof entityId === "string") return entityId
    const ids = Array.isArray(displayedEntityIds) ? displayedEntityIds : []
    return ids[0] || ""
}
