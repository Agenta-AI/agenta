import {extractColumnsFromData} from "@agenta/entities/testcase"
import {readTestsetFilePreview, type TestsetFileType} from "@agenta/entities/testset"

import {INVALID_CSV, INVALID_JSON} from "../create/testsetFileCheck"

/** What the import needs to know about the whole file, past the preview rows. */
export type ImportFileCheck = {ok: true; missingColumns: string[]} | {ok: false; message: string}

export const NO_ROWS = "This file has no rows to import."

/**
 * The current columns the file does not hold. The import replaces every row, so these columns
 * are gone in the new revision. The file columns come from the same extraction as the grid
 * columns, so a nested value gives the same dotted path on both sides. The server keeps a CSV
 * cell as text, so a cell that holds JSON gives one column, not its nested paths.
 */
export const missingColumns = (
    currentColumns: string[],
    fileRows: Record<string, unknown>[],
): string[] => {
    const fileColumns = new Set(
        extractColumnsFromData(fileRows, {sampleSize: fileRows.length}).map((column) => column.key),
    )
    return currentColumns.filter((column) => !fileColumns.has(column))
}

/**
 * Read every row of a file that already passed the format check. A file with no rows is
 * refused: importing it would save a revision with no rows at all.
 */
export async function checkImportFile(
    file: File,
    fileType: TestsetFileType,
    currentColumns: string[],
): Promise<ImportFileCheck> {
    const invalid = {ok: false, message: fileType === "csv" ? INVALID_CSV : INVALID_JSON} as const
    let result: Awaited<ReturnType<typeof readTestsetFilePreview>>
    try {
        result = await readTestsetFilePreview(file, fileType, Number.POSITIVE_INFINITY)
    } catch {
        // The browser could not read the file again.
        return invalid
    }
    if (!result.ok) return invalid
    if (result.rows.length === 0) return {ok: false, message: NO_ROWS}
    return {ok: true, missingColumns: missingColumns(currentColumns, result.rows)}
}
