import {
    detectTestsetFileType,
    readTestsetFilePreview,
    type TestsetFileType,
} from "@agenta/entities/testset"

/** How many rows the preview shows. */
export const PREVIEW_ROWS = 5

export const UNSUPPORTED_FORMAT = "Unsupported file format. Please upload a CSV or JSON file."
export const INVALID_CSV =
    "Invalid CSV format. Ensure it has comma-separated values with headers in the first row."
export const INVALID_JSON =
    "Invalid JSON format. Ensure it's an array of objects with consistent keys."

export type TestsetFileCheck =
    | {ok: true; fileType: TestsetFileType; rows: Record<string, unknown>[]}
    | {ok: false; fileType: TestsetFileType | null; message: string}

/**
 * Check that a file is a CSV or JSON file the server can read. The type comes from the extension.
 * A JSON file must hold at least one object, as the upload makes one row per object.
 */
export async function checkTestsetFile(file: File): Promise<TestsetFileCheck> {
    const fileType = detectTestsetFileType(file.name)
    if (!fileType) return {ok: false, fileType: null, message: UNSUPPORTED_FORMAT}

    const invalid = fileType === "csv" ? INVALID_CSV : INVALID_JSON
    try {
        const result = await readTestsetFilePreview(file, fileType, PREVIEW_ROWS)
        if (!result.ok || (fileType === "json" && result.rows.length === 0)) {
            return {ok: false, fileType, message: invalid}
        }
        return {ok: true, fileType, rows: result.rows}
    } catch {
        // The browser could not read the file at all.
        return {ok: false, fileType, message: invalid}
    }
}
