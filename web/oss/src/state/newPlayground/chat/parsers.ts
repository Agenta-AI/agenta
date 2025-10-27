// Shared helpers for parsing/normalizing chat message shapes and tool-call arrays

import JSON5 from "json5"

export interface NormalizedMessage {
    role: string
    content: any
}

// Try to parse a JSON array or object string into an array. Returns null if not an array.
export function tryParseArrayFromString(s: string): any[] | null {
    try {
        const t = s.trim()
        if (!t.startsWith("[") && !t.startsWith("{")) return null
        const parsed = JSON5.parse(s)
        return Array.isArray(parsed) ? parsed : null
    } catch {
        return null
    }
}

// Normalize a single row's messages field (array or JSON string) into messages list
export function normalizeMessagesFromField(raw: any): NormalizedMessage[] {
    const out: NormalizedMessage[] = []
    if (!raw) return out
    const pushFrom = (m: any) => {
        const role = String(m?.role || m?.role?.value || "user").toLowerCase()
        const rc = m?.content
        const content = Array.isArray(rc)
            ? rc
            : rc && typeof rc === "object" && "value" in rc
              ? (rc as any).value
              : rc

        const toolCalls =
            m?.tool_calls ??
            m?.toolCalls ??
            m?.toolCalls?.value ??
            m?.tool_calls?.value ??
            undefined

        const functionCall =
            m?.function_call ??
            m?.functionCall ??
            m?.function_call?.value ??
            m?.functionCall?.value ??
            undefined

        const toolCallId =
            m?.tool_call_id ??
            m?.toolCallId ??
            m?.toolCallId?.value ??
            m?.tool_call_id?.value ??
            undefined

        const toolName =
            m?.name ?? m?.tool_name ?? m?.name?.value ?? m?.tool_name?.value ?? undefined

        const payload: any = {role, content}
        if (toolCalls !== undefined) payload.tool_calls = toolCalls
        if (functionCall !== undefined) payload.function_call = functionCall
        if (toolCallId !== undefined)
            payload.tool_call_id =
                typeof toolCallId === "object" && toolCallId !== null
                    ? (toolCallId.value ?? toolCallId)
                    : toolCallId
        if (toolName !== undefined)
            payload.name =
                typeof toolName === "object" && toolName !== null
                    ? (toolName.value ?? toolName)
                    : toolName

        out.push(payload)
    }
    if (Array.isArray(raw)) {
        for (const m of raw) pushFrom(m)
        return out
    }
    if (typeof raw === "string") {
        try {
            const parsed = JSON5.parse(raw)
            if (Array.isArray(parsed)) for (const m of parsed) pushFrom(m)
        } catch {}
    }
    return out
}

// Aggregate normalized messages across many rows (using a field accessor)
export function extractAllMessagesFromRows(
    rows: Record<string, any>[],
    field = "messages",
): NormalizedMessage[] {
    const result: NormalizedMessage[] = []
    for (const row of rows || []) {
        const raw = (row as any)?.[field]
        if (!raw) continue
        result.push(...normalizeMessagesFromField(raw))
    }
    return result
}

// Derive a unified view model for rendering generation responses.
// Returns a potential toolData array (for ToolCallView), and a fallback text with JSON pretty-print flag.
export function deriveToolViewModelFromResult(result: any): {
    toolData: any[] | null
    isJSON: boolean
    displayValue: string
} {
    const rawData = (result as any)?.response?.data
    const contentCandidate =
        typeof rawData === "string"
            ? rawData
            : rawData && typeof rawData === "object"
              ? ((rawData as any).content ?? (rawData as any).data ?? "")
              : ""

    // Tool-call candidates
    let arr: any[] | null = null
    if (typeof contentCandidate === "string") arr = tryParseArrayFromString(contentCandidate)
    if (!arr && Array.isArray(contentCandidate)) arr = contentCandidate
    if (!arr && typeof rawData === "string") arr = tryParseArrayFromString(rawData)
    if (!arr && Array.isArray(rawData)) arr = rawData

    // Fallback editor content
    let isJSON = false
    let displayValue =
        typeof contentCandidate === "string" ? contentCandidate : String(contentCandidate ?? "")
    if (typeof contentCandidate === "string") {
        try {
            const parsed = JSON5.parse(contentCandidate)
            isJSON = true
            displayValue = JSON.stringify(parsed, null, 2)
        } catch {
            isJSON = false
        }
    }
    return {toolData: arr, isJSON, displayValue}
}
