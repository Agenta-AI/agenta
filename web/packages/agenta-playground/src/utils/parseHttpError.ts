/**
 * Parses a raw HTTP error response body into a structured error object.
 * Handles both the Python SDK's `status` envelope and FastAPI's `detail` field.
 */
export interface HttpErrorBody {
    message: string
    stacktrace?: string | string[]
}

const DEFAULT_MESSAGE = "Request failed"

export function parseHttpErrorBody(text: string, fallbackMessage = DEFAULT_MESSAGE): HttpErrorBody {
    if (!text) return {message: fallbackMessage}
    try {
        const data = JSON.parse(text)
        if (data?.status?.message) {
            return {
                message: data.status.message,
                ...(data.status.stacktrace != null ? {stacktrace: data.status.stacktrace} : {}),
            }
        }
        if (data?.detail?.message) {
            return {
                message: data.detail.message,
                ...(data.detail.stacktrace != null ? {stacktrace: data.detail.stacktrace} : {}),
            }
        }
        if (typeof data?.detail === "string") {
            return {message: data.detail}
        }
        return {message: fallbackMessage}
    } catch {
        return {message: text}
    }
}

/**
 * Coerces a raw stacktrace (string | string[] | undefined) to a plain string.
 * Array frames are joined with "\n". Returns undefined when absent or empty.
 */
export function normalizeStacktrace(raw: string | string[] | undefined): string | undefined {
    if (raw === undefined) return undefined
    const result = Array.isArray(raw) ? raw.join("\n") : raw
    return result || undefined
}
