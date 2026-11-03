import {extractColumnsFromData} from "@agenta/entities/testcase"
import {readTestsetFilePreview, type TestsetFileType} from "@agenta/entities/testset"

import {INVALID_CSV, INVALID_JSON} from "../create/testsetFileCheck"

/** What the import needs to know about the whole file, past the preview rows. */
export type ImportFileCheck = {ok: true; missingColumns: string[]} | {ok: false; message: string}

export const NO_ROWS = "This file has no rows to import."

/**
 * The current columns the file does not hold. The import replaces every row, so these columns
 * are gone in the new revision. A file column that holds an object covers the nested columns
 * under it (`inputs` covers `inputs.country`), as a CSV cell can carry the whole object.
 */
export const missingColumns = (
    currentColumns: string[],
    fileRows: Record<string, unknown>[],
): string[] => {
    const fileColumns = new Set(
        extractColumnsFromData(fileRows, {sampleSize: fileRows.length}).map((column) => column.key),
    )
    const covered = (column: string): boolean => {
        if (fileColumns.has(column)) return true
        const dot = column.lastIndexOf(".")
        return dot > 0 && covered(column.slice(0, dot))
    }
    return currentColumns.filter((column) => !covered(column))
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
