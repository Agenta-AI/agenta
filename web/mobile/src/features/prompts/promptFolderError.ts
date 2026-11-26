/**
 * The sentence the folders endpoint sends for a bad name or a name already taken (400, 409), or
 * `null` for any other failure. Other text from the server never reaches the reader.
 */
export const folderErrorSentence = (error: unknown): string | null => {
    const failure = error as {statusCode?: number; body?: {detail?: unknown}} | null
    if (failure?.statusCode !== 400 && failure?.statusCode !== 409) return null
    const detail = failure.body?.detail
    return typeof detail === "string" && detail.trim() ? detail : null
}
