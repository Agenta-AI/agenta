// Workbook bytes → cell strings (design D5); only text leaves here, never SheetJS HTML.
import {read, utils, type CellObject, type WorkSheet} from "xlsx"

import type {CellOrigin} from "./cellAddress"

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
    /** Where `rows[0][0]` sits in the sheet; the used range need not start at A1. */
    origin: CellOrigin
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
    if (!ref) return {name, rows: [], truncated: NOT_TRUNCATED, origin: {r: 0, c: 0}}
    const start = utils.decode_range(ref).s
    const origin = {r: start.r, c: start.c}
    let lastRow = -1
    let lastCol = -1
    for (const address of Object.keys(sheet)) {
        if (address.startsWith("!")) continue
        if (isEmpty(toSheetCell(sheet[address] as CellObject))) continue
        const {r, c} = utils.decode_cell(address)
        if (r > lastRow) lastRow = r
        if (c > lastCol) lastCol = c
    }
    if (lastRow < start.r || lastCol < start.c)
        return {name, rows: [], truncated: NOT_TRUNCATED, origin: {r: 0, c: 0}}

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
        origin,
    }
}

// A workbook may unpack to at most this much XML, and to at most this many times its own size.
const MAX_UNPACKED_BYTES = 100 * 1024 * 1024
const MAX_UNPACK_RATIO = 100

/** Thrown before parsing when the ZIP would unpack past the limits (a zip bomb or a huge sheet). */
export class UnpackTooLarge extends Error {
    constructor(readonly unpackedBytes: number) {
        super("workbook unpacks too large")
    }
}

/** The entries' declared uncompressed sizes, read from the ZIP central directory; null if unreadable. */
export function zipUnpackedSize(data: Uint8Array): number | null {
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
    for (let eocd = data.length - 22; eocd >= Math.max(0, data.length - 65557); eocd--) {
        if (view.getUint32(eocd, true) !== 0x06054b50) continue
        let at = view.getUint32(eocd + 16, true)
        let total = 0
        for (let n = view.getUint16(eocd + 10, true); n > 0; n--) {
            if (at + 46 > data.length || view.getUint32(at, true) !== 0x02014b50) return null
            const size = view.getUint32(at + 24, true)
            if (size === 0xffffffff) return Infinity
            total += size
            at +=
                46 +
                view.getUint16(at + 28, true) +
                view.getUint16(at + 30, true) +
                view.getUint16(at + 32, true)
        }
        return total
    }
    return null
}

/** Throws when the bytes are not a workbook, so the caller can fall back to download. */
export function parseWorkbook(bytes: ArrayBuffer | Uint8Array): Workbook {
    const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
    // SheetJS also reads plain text as a one-column sheet; a renamed text file is not a workbook.
    if (!startsWith(data, ZIP_MAGIC) && !startsWith(data, CFB_MAGIC))
        throw new Error("not a workbook")
    if (startsWith(data, ZIP_MAGIC)) {
        const unpacked = zipUnpackedSize(data)
        if (unpacked === null) throw new Error("not a workbook")
        if (unpacked > MAX_UNPACKED_BYTES || unpacked > MAX_UNPACK_RATIO * data.length)
            throw new UnpackTooLarge(unpacked)
    }
    const book = read(data, {
        type: "array",
        cellFormula: true,
        sheetStubs: true,
        sheetRows: ROW_CAP + 1,
    })
    return {sheets: book.SheetNames.map((name) => readSheet(name, book.Sheets[name]))}
}
