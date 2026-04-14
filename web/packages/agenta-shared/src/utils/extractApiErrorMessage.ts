function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value)
}

function extractMessageFromPayload(payload: unknown): string | null {
    if (typeof payload === "string") {
        const trimmed = payload.trim()
        return trimmed || null
    }

    if (Array.isArray(payload)) {
        const messages = payload
            .map((item) => extractMessageFromPayload(item))
            .filter((message): message is string => Boolean(message))

        return messages.length > 0 ? messages.join(", ") : null
    }

    if (!isRecord(payload)) return null

    const nestedMessageKeys = ["status", "detail", "message", "error", "msg"] as const
    for (const key of nestedMessageKeys) {
        const message = extractMessageFromPayload(payload[key])
        if (message) return message
    }

    return null
}

/**
 * Extract a human-readable API error message from thrown values, including
 * Axios/Fetch-style payloads like `{detail: {message: "..."}}`.
 */
export function extractApiErrorMessage(error: unknown): string {
    if (isRecord(error) && "response" in error) {
        const response = error.response
        const responseData = isRecord(response) ? response.data : undefined
        const responseMessage = extractMessageFromPayload(responseData)
        if (responseMessage) return responseMessage
    }

    const directMessage = extractMessageFromPayload(error)
    if (directMessage) return directMessage

    if (error instanceof Error && error.message) return error.message
    return String(error)
}
