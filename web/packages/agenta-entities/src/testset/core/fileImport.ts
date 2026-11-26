/**
 * Testset File Import - Pure Helpers
 *
 * File type detection, CSV parsing, and the preview reader used when a
 * user imports a testset from a file. No external dependencies.
 */

export type TestsetFileType = "csv" | "json"

export type TestsetFilePreviewResult =
    /** `rows` holds at most `maxRows` rows; `totalRows` counts every data row in the file. */
    | {ok: true; rows: Record<string, unknown>[]; totalRows: number}
    | {ok: false; reason: "invalid-csv" | "invalid-json"}

/**
 * Return the file type from the file name extension, ignoring case.
 * Return null for any other extension.
 */
export function detectTestsetFileType(fileName: string): TestsetFileType | null {
    const lowerName = fileName.toLowerCase()
    if (lowerName.endsWith(".csv")) return "csv"
    if (lowerName.endsWith(".json")) return "json"
    return null
}

/**
 * Parse CSV text into rows of fields. Field whitespace is kept, as the server keeps it.
 *
 * - Quoted fields may contain commas and line breaks.
 * - A doubled quote inside a quoted field becomes one quote.
 * - Rows end with \r\n, \n, or a lone \r.
 * - Rows where every field is empty or blank are dropped.
 */
export function parseCsvRows(text: string): string[][] {
    const rows: string[][] = []
    let row: string[] = []
    let field = ""
    let inQuotes = false

    const endField = () => {
        row.push(field)
        field = ""
    }
    const endRow = () => {
        if (row.some((value) => value.trim() !== "")) rows.push(row)
        row = []
    }

    for (let index = 0; index < text.length; index += 1) {
        const char = text[index]

        if (inQuotes) {
            if (char === '"') {
                if (text[index + 1] === '"') {
                    field += '"'
                    index += 1
                } else {
                    inQuotes = false
                }
            } else {
                field += char
            }
            continue
        }

        if (char === '"') {
            inQuotes = true
        } else if (char === ",") {
            endField()
        } else if (char === "\r") {
            endField()
            endRow()
            if (text[index + 1] === "\n") index += 1
        } else if (char === "\n") {
            endField()
            endRow()
        } else {
            field += char
        }
    }

    if (field !== "" || row.length > 0) {
        endField()
        endRow()
    }

    return rows
}

/**
 * Read up to maxRows data rows from a CSV or JSON file for a preview.
 *
 * - CSV: the first parsed row is the header. Missing values become "".
 *   Invalid only when no row parses.
 * - JSON: valid when the text parses. Rows come only from a root array.
 *   Non-object array items are skipped.
 */
export async function readTestsetFilePreview(
    file: File,
    type: "csv" | "json",
    maxRows = 10,
): Promise<TestsetFilePreviewResult> {
    const text = await file.text()

    if (type === "csv") {
        const parsed = parseCsvRows(text)
        if (parsed.length === 0) return {ok: false, reason: "invalid-csv"}

        const [header, ...dataRows] = parsed
        const totalRows = dataRows.length
        const rows = dataRows.slice(0, maxRows).map((values) => {
            const record: Record<string, unknown> = {}
            header.forEach((key, column) => {
                record[key] = values[column] ?? ""
            })
            return record
        })
        return {ok: true, rows, totalRows}
    }

    let parsedJson: unknown
    try {
        parsedJson = JSON.parse(text)
    } catch {
        return {ok: false, reason: "invalid-json"}
    }

    if (!Array.isArray(parsedJson)) return {ok: true, rows: [], totalRows: 0}

    const objects = parsedJson.filter(
        (item): item is Record<string, unknown> =>
            typeof item === "object" && item !== null && !Array.isArray(item),
    )
    return {ok: true, rows: objects.slice(0, maxRows), totalRows: objects.length}
}
