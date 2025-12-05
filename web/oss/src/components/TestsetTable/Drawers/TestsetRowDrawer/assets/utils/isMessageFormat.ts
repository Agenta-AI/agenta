/**
 * Checks if a value is in message format (OpenAI chat messages)
 * Messages can be:
 * 1. An array of message objects: [{role: "user", content: "..."}, ...]
 * 2. A single message object: {role: "user", content: "..."}
 *
 * Note: Messages must have "role" and at least one of: "content", "tool_calls", or "function_call"
 */
export function isMessageFormat(value: any): boolean {
    if (!value) return false

    try {
        let parsed = value

        // If it's a string, try to parse it
        if (typeof value === "string") {
            try {
                parsed = JSON.parse(value)
            } catch {
                return false
            }
        }

        // Helper to check if an object is a valid message
        const isValidMessage = (msg: any) => {
            if (typeof msg !== "object" || msg === null) return false
            if (!("role" in msg)) return false

            // Message must have at least one of these fields
            return "content" in msg || "tool_calls" in msg || "function_call" in msg
        }

        // Check if it's an array of message objects
        if (Array.isArray(parsed)) {
            return parsed.length > 0 && parsed.every(isValidMessage)
        }

        // Check if it's a single message object
        if (typeof parsed === "object" && parsed !== null) {
            return isValidMessage(parsed)
        }

        return false
    } catch {
        return false
    }
}

/**
 * Converts message format value to JSON string for rendering
 */
export function messageFormatToString(value: any): string {
    if (typeof value === "string") {
        return value
    }
    return JSON.stringify(value)
}
