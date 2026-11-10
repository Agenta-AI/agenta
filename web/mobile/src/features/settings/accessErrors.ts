/** Plain-language message for a failed access action. The server text is never shown. */
export const plainAccessError = (error: unknown, fallback: string): string => {
    const candidate = error as {statusCode?: number; response?: {status?: number}} | null
    const status = candidate?.statusCode ?? candidate?.response?.status
    if (status === 403) return "You do not have permission to do that."
    if (status === 409) return "That already exists. Choose a different value."
    return fallback
}
