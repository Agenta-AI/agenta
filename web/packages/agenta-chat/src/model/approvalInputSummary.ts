/** The readable part of a gate's payload: `{label, text}`, empty text when there is nothing to show. */
export interface ApprovalInputSummary {
    /** The field the text came from ("command", "query", …) or "Input" for the JSON fallback. */
    label: string
    text: string
}

// Fields tools use for their one human-readable argument — a bash gate must read as the command
// itself, not as a JSON blob. Order is priority order.
const PRIMARY_FIELDS = [
    "command",
    "cmd",
    "script",
    "query",
    "sql",
    "url",
    "path",
    "file_path",
    "prompt",
    "message",
    "content",
    "text",
]

/** Pick the payload's primary field when it has one; otherwise fall back to compact JSON. */
export const summarizeApprovalInput = (input: unknown): ApprovalInputSummary => {
    if (input == null) return {label: "Input", text: ""}
    if (typeof input === "string") return {label: "Input", text: input}
    if (typeof input !== "object") return {label: "Input", text: String(input)}
    const record = input as Record<string, unknown>
    for (const field of PRIMARY_FIELDS) {
        const value = record[field]
        if (typeof value === "string" && value.trim()) return {label: field, text: value}
    }
    try {
        const json = JSON.stringify(input)
        return {label: "Input", text: json === "{}" ? "" : json}
    } catch {
        return {label: "Input", text: String(input)}
    }
}
