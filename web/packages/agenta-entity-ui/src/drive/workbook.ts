// Workbook bytes → cell strings (design D5); only text leaves here, never SheetJS HTML.
import {read, utils, type CellObject, type WorkSheet} from "xlsx"

/** A stored value, or the formula text of a formula cell that has no stored value. */
export type SheetCell = {value: string} | {formula: string}

/** Which caps cut the sheet; `totalColumns` is set only when columns were cut. */
export interface Truncation {
    rows: boolean
    totalColumns: number | null
}

export const NOT_TRUNCATED: Truncation = {rows: false, totalColumns: null}

export interface Sheet {
    name: string
    rows: SheetCell[][]
    truncated: Truncation
}

export interface Workbook {
    sheets: Sheet[]
}

/** Header row plus 500 data rows. */
export const ROW_CAP = 501
export const COL_CAP = 50

const EMPTY: SheetCell = {value: ""}

/** The closed mapping table of D5. */
export function toSheetCell(cell: CellObject | undefined): SheetCell {
    if (!cell) return EMPTY
    if (cell.t === "z") return cell.f ? {formula: `=${cell.f}`} : EMPTY
    return {value: cell.w ?? String(cell.v ?? "")}
}

const isEmpty = (cell: SheetCell): boolean => "value" in cell && cell.value === ""

const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04]
const CFB_MAGIC = [0xd0, 0xcf, 0x11, 0xe0]

const startsWith = (bytes: Uint8Array, magic: number[]): boolean =>
    magic.every((byte, i) => bytes[i] === byte)

function readSheet(name: string, sheet: WorkSheet): Sheet {
    const ref = sheet["!ref"]
    if (!ref) return {name, rows: [], truncated: NOT_TRUNCATED}
    const start = utils.decode_range(ref).s
    let lastRow = -1
    let lastCol = -1
    for (const address of Object.keys(sheet)) {
        if (address.startsWith("!")) continue
        if (isEmpty(toSheetCell(sheet[address] as CellObject))) continue
        const {r, c} = utils.decode_cell(address)
        if (r > lastRow) lastRow = r
        if (c > lastCol) lastCol = c
    }
    if (lastRow < start.r || lastCol < start.c) return {name, rows: [], truncated: NOT_TRUNCATED}

    const rowCount = lastRow - start.r + 1
    const colCount = lastCol - start.c + 1
    const rows: SheetCell[][] = []
    for (let r = start.r; r < start.r + Math.min(rowCount, ROW_CAP); r++) {
        const row: SheetCell[] = []
        for (let c = start.c; c < start.c + Math.min(colCount, COL_CAP); c++)
            row.push(toSheetCell(sheet[utils.encode_cell({r, c})] as CellObject | undefined))
        rows.push(row)
    }
    return {
        name,
        rows,
        truncated: {rows: rowCount > ROW_CAP, totalColumns: colCount > COL_CAP ? colCount : null},
    }
}

/** Throws when the bytes are not a workbook, so the caller can fall back to download. */
export function parseWorkbook(bytes: ArrayBuffer | Uint8Array): Workbook {
    const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
    // SheetJS also reads plain text as a one-column sheet; a renamed text file is not a workbook.
    if (!startsWith(data, ZIP_MAGIC) && !startsWith(data, CFB_MAGIC))
        throw new Error("not a workbook")
    const book = read(data, {
        type: "array",
        cellFormula: true,
        sheetStubs: true,
        sheetRows: ROW_CAP + 1,
    })
    return {sheets: book.SheetNames.map((name) => readSheet(name, book.Sheets[name]))}
}
