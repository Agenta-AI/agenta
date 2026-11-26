import type {TestsetFileType} from "@agenta/entities/testset"

/**
 * The server answers 400 "Failed to read ... file" when it cannot parse the file. An older
 * path answers 422 with `csvdata` in the detail. Both mean the file is malformed.
 */
const isMalformedFile = (error: unknown): boolean => {
    const {statusCode, body} = error as {statusCode?: number; body?: {detail?: unknown}}
    const detail = JSON.stringify(body?.detail ?? "")
    if (statusCode === 400) return detail.includes("Failed to read")
    return statusCode === 422 && detail.includes("csvdata")
}

/**
 * What to tell the reader when the server refused an uploaded file: the malformed file message,
 * or `fallback`. The server's own text never reaches the reader.
 */
export const uploadFailureMessage = (
    error: unknown,
    fileType: TestsetFileType,
    fallback: string,
): string =>
    isMalformedFile(error)
        ? `The file you uploaded is either malformed or is not a valid ${fileType.toUpperCase()} file`
        : fallback
