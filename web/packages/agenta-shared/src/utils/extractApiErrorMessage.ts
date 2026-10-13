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

export type ErrorWithResponseStatus = Error & {response?: {status?: number}}

/**
 * Wraps an error value while preserving the HTTP response status, if present.
 * Pass an explicit `message` to override the message (e.g. when using extractApiErrorMessage).
 * Omit `message` to preserve the original error message.
 */
export function preserveResponseStatus(error: unknown, message?: string): ErrorWithResponseStatus {
    const err = (
        message !== undefined
            ? new Error(message)
            : error instanceof Error
              ? error
              : new Error(String(error))
    ) as ErrorWithResponseStatus
    const status = (error as {response?: {status?: number}})?.response?.status
    if (status !== undefined) {
        err.response = {status}
    }
    return err
}

/**
 * Extract a human-readable API error message from thrown values, including
 * Axios/Fetch-style payloads like `{detail: {message: "..."}}` and Fern client errors.
 */
export function extractApiErrorMessage(error: unknown): string {
    if (isRecord(error) && "response" in error) {
        const response = error.response
        const responseData = isRecord(response) ? response.data : undefined
        const responseMessage = extractMessageFromPayload(responseData)
        if (responseMessage) return responseMessage
    }

    // Fern client errors carry the parsed response body on `body`; their `message` is the
    // status line plus the raw JSON, which is not a sentence to show a user. A string body
    // (an HTML error page, say) is not a message either, so only a JSON body is read.
    if (isRecord(error) && typeof error.body === "object" && error.body !== null) {
        const bodyMessage = extractMessageFromPayload(error.body)
        if (bodyMessage) return bodyMessage
    }

    const directMessage = extractMessageFromPayload(error)
    if (directMessage) return directMessage

    if (error instanceof Error && error.message) return error.message
    return String(error)
}
