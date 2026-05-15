/**
 * Parses a raw HTTP error response body into a structured error object.
 * Handles both the Python SDK's `status` envelope and FastAPI's `detail` field.
 */
export interface HttpErrorBody {
    message: string
    stacktrace?: string | string[]
}

const DEFAULT_MESSAGE = "Request failed"

function extractFromParsed(data: unknown, fallbackMessage: string): HttpErrorBody {
    const obj = data as Record<string, unknown> | null
    if (obj?.status && typeof (obj.status as Record<string, unknown>)?.message === "string") {
        const s = obj.status as Record<string, unknown>
        return {
            message: s.message as string,
            ...(s.stacktrace != null ? {stacktrace: s.stacktrace as string | string[]} : {}),
        }
    }
    if (obj?.detail && typeof (obj.detail as Record<string, unknown>)?.message === "string") {
        const d = obj.detail as Record<string, unknown>
        return {
            message: d.message as string,
            ...(d.stacktrace != null ? {stacktrace: d.stacktrace as string | string[]} : {}),
        }
    }
    if (typeof obj?.detail === "string") {
        return {message: obj.detail}
    }
    return {message: fallbackMessage}
}

export function parseHttpErrorBody(
    input: string | unknown,
    fallbackMessage = DEFAULT_MESSAGE,
): HttpErrorBody {
    if (input === null || input === undefined || input === "") return {message: fallbackMessage}
    if (typeof input === "string") {
        try {
            return extractFromParsed(JSON.parse(input), fallbackMessage)
        } catch {
            return {message: input}
        }
    }
    return extractFromParsed(input, fallbackMessage)
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
