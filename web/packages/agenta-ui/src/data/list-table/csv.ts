import type {ListTableCsvColumn} from "./types"

type CsvValue = string | number | boolean | null | undefined

/**
 * A spreadsheet runs a cell that starts with one of these as a formula. A list exports names the
 * user typed, so a text value is prefixed with `'` to stay text. Numbers are left alone: `-5` is
 * a value, not a formula.
 */
const FORMULA_START = /^[=+\-@\t\r]/

const field = (value: CsvValue): string => {
    if (value === null || value === undefined) return ""
    let text = String(value)
    if (typeof value === "string" && FORMULA_START.test(text)) text = `'${text}`
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

/**
 * The rows as CSV text (RFC 4180): a header line from the column labels, then one line per row,
 * lines joined with CRLF. A field with a comma, a double quote or a line break is quoted, and a
 * double quote inside it is doubled.
 */
export const listTableToCsv = <Row>(rows: readonly Row[], columns: ListTableCsvColumn<Row>[]) =>
    [
        columns.map((column) => field(column.label)).join(","),
        ...rows.map((row) => columns.map((column) => field(column.value(row))).join(",")),
    ].join("\r\n")

/**
 * Saves CSV text as a file. The byte order mark makes spreadsheet apps read the file as UTF-8,
 * so names with accents or emoji survive the round trip.
 */
export const downloadCsv = (fileName: string, csv: string) => {
    const blob = new Blob(["\uFEFF", csv], {type: "text/csv;charset=utf-8"})
    const url = URL.createObjectURL(blob)
    const link = document.createElement("a")
    link.href = url
    link.download = fileName.endsWith(".csv") ? fileName : `${fileName}.csv`
    document.body.appendChild(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(url)
}
