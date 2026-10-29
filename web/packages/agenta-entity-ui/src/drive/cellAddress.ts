// A1 addresses for preview tables, kept free of SheetJS so the CSV preview stays light.

/** Where `rows[0][0]` sits in its sheet, 0-based. */
export interface CellOrigin {
    r: number
    c: number
}

/** A rectangle of table row and column indices, inclusive. */
export interface CellBox {
    top: number
    left: number
    bottom: number
    right: number
}

export const columnName = (c: number): string => {
    let name = ""
    for (let n = c + 1; n > 0; n = Math.floor((n - 1) / 26))
        name = String.fromCharCode(65 + ((n - 1) % 26)) + name
    return name
}

export const encodeCell = (r: number, c: number): string => `${columnName(c)}${r + 1}`

const decodeCell = (ref: string): CellOrigin | null => {
    const match = /^([A-Z]{1,3})([1-9]\d*)$/.exec(ref)
    if (!match) return null
    let c = 0
    for (const letter of match[1]) c = c * 26 + (letter.charCodeAt(0) - 64)
    return {r: Number(match[2]) - 1, c: c - 1}
}

/** The box in the sheet's own A1 coordinates: `B4`, or `B4:C5` for more than one cell. */
export function boxToRange(origin: CellOrigin, box: CellBox): string {
    const start = encodeCell(origin.r + box.top, origin.c + box.left)
    const end = encodeCell(origin.r + box.bottom, origin.c + box.right)
    return start === end ? start : `${start}:${end}`
}

/** The inverse of {@link boxToRange}; null for a malformed range or one before the origin. */
export function rangeToBox(origin: CellOrigin, range: string): CellBox | null {
    const [first, last = first] = range.split(":")
    const s = decodeCell(first)
    const e = decodeCell(last)
    if (!s || !e) return null
    const box = {
        top: s.r - origin.r,
        left: s.c - origin.c,
        bottom: e.r - origin.r,
        right: e.c - origin.c,
    }
    if (box.top < 0 || box.left < 0 || box.bottom < box.top || box.right < box.left) return null
    return box
}

/** The widest row's length: CSV rows can run longer than the header. */
export const tableWidth = (rows: readonly (readonly unknown[])[]): number =>
    rows.reduce((width, row) => Math.max(width, row.length), 0)
