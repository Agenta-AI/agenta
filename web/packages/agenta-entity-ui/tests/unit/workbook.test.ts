import {readFileSync} from "node:fs"
import {join} from "node:path"

import {zipSync} from "fflate"
import {describe, expect, it} from "vitest"
import {utils, write} from "xlsx"

import {boxToRange, rangeToBox} from "../../src/drive/cellAddress"
import {
    COL_CAP,
    parseWorkbook,
    ROW_CAP,
    UnpackTooLarge,
    zipUnpackedSize,
} from "../../src/drive/workbook"

const fixture = (name: string) => readFileSync(join(__dirname, "../fixtures/office", name))

const book = (sheets: Record<string, ReturnType<typeof utils.aoa_to_sheet>>): Uint8Array => {
    const wb = utils.book_new()
    for (const [name, sheet] of Object.entries(sheets)) utils.book_append_sheet(wb, sheet, name)
    return new Uint8Array(write(wb, {type: "array", bookType: "xlsx"}) as ArrayBuffer)
}

describe("parseWorkbook", () => {
    it("keeps the stored number behind formatted text, but not behind a date", () => {
        const sheet = utils.aoa_to_sheet([[0.256, 46317, 120]])
        sheet.A1.z = "0.0%"
        sheet.B1.z = "yyyy-mm-dd"
        const [row] = parseWorkbook(book({Data: sheet})).sheets[0].rows
        expect(row).toEqual([
            {value: "25.6%", numeric: true, raw: "0.256"},
            {value: "2026-10-22", numeric: true},
            {value: "120", numeric: true},
        ])
    })

    it("keeps a stored value with its formula, and marks numbers", () => {
        const sheet = utils.aoa_to_sheet([
            ["Region", "Q1", "Q2", "Total"],
            ["North", 120, 140],
        ])
        sheet.D2 = {t: "n", v: 260, f: "B2+C2"}
        const {sheets} = parseWorkbook(book({Sales: sheet}))
        expect(sheets[0].rows).toEqual([
            [{value: "Region"}, {value: "Q1"}, {value: "Q2"}, {value: "Total"}],
            [
                {value: "North"},
                {value: "120", numeric: true},
                {value: "140", numeric: true},
                {value: "260", formula: "=B2+C2", numeric: true},
            ],
        ])
    })

    it("shows the formula of an openpyxl cell with no stored value, in sheet order", () => {
        const {sheets} = parseWorkbook(fixture("openpyxl-formulas.xlsx"))
        expect(sheets.map((s) => s.name)).toEqual(["Sales", "Notes"])
        expect(sheets[0].rows[3]).toEqual([
            {value: "West"},
            {value: "75", numeric: true},
            {value: "80", numeric: true},
            {formula: "=B4+C4"},
        ])
        expect(sheets[0].rows[1][3]).toEqual({formula: "=B2+C2"})
        expect(sheets[0].truncated).toEqual({rows: false, totalColumns: null})
        expect(sheets[1].rows).toEqual([[{value: "Written by an agent"}]])
    })

    it("trims styled blanks at C5 and Z2000 to the data range", () => {
        const {sheets} = parseWorkbook(fixture("styled-blanks.xlsx"))
        expect(sheets[0]).toEqual({
            name: "Data",
            rows: [
                [{value: "Name"}, {value: "Score"}],
                [{value: "Ada"}, {value: "9", numeric: true}],
            ],
            truncated: {rows: false, totalColumns: null},
            origin: {r: 0, c: 0},
        })
    })

    it("records where the used range starts when it is not A1", () => {
        const sheet = utils.aoa_to_sheet(
            [
                ["Region", "Q1"],
                ["North", 120],
            ],
            {origin: "B3"},
        )
        // SheetJS widens a fresh sheet's range to A1; a file's own dimension starts at its data.
        sheet["!ref"] = "B3:C4"
        const {sheets} = parseWorkbook(book({Data: sheet, Empty: utils.aoa_to_sheet([])}))
        expect(sheets[0].origin).toEqual({r: 2, c: 1})
        expect(sheets[0].rows).toEqual([
            [{value: "Region"}, {value: "Q1"}],
            [{value: "North"}, {value: "120", numeric: true}],
        ])
        expect(sheets[1].origin).toEqual({r: 0, c: 0})
    })

    it("caps rows and columns and marks the sheet truncated", () => {
        const tall = Array.from({length: ROW_CAP + 40}, (_, i) => [`r${i}`])
        const wide = [Array.from({length: COL_CAP + 10}, (_, i) => `c${i}`)]
        const {sheets} = parseWorkbook(
            book({Tall: utils.aoa_to_sheet(tall), Wide: utils.aoa_to_sheet(wide)}),
        )
        expect(sheets[0].rows).toHaveLength(ROW_CAP)
        expect(sheets[0].rows[ROW_CAP - 1]).toEqual([{value: `r${ROW_CAP - 1}`}])
        expect(sheets[0].truncated).toEqual({rows: true, totalColumns: null})
        expect(sheets[1].rows[0]).toHaveLength(COL_CAP)
        expect(sheets[1].rows[0][COL_CAP - 1]).toEqual({value: `c${COL_CAP - 1}`})
        expect(sheets[1].truncated).toEqual({rows: false, totalColumns: COL_CAP + 10})
    })

    it("keeps a sheet with exactly the row cap untruncated", () => {
        const exact = Array.from({length: ROW_CAP}, (_, i) => [i])
        const {sheets} = parseWorkbook(book({Exact: utils.aoa_to_sheet(exact)}))
        expect(sheets[0].rows).toHaveLength(ROW_CAP)
        expect(sheets[0].truncated).toEqual({rows: false, totalColumns: null})
    })

    it("rejects bytes that are not a workbook", () => {
        expect(() => parseWorkbook(new TextEncoder().encode("Region,Q1\nNorth,1\n"))).toThrow(
            "not a workbook",
        )
    })
})

describe("A1 ranges", () => {
    const origin = {r: 2, c: 1}

    it("encodes a box in the sheet's own coordinates", () => {
        expect(boxToRange(origin, {top: 1, left: 0, bottom: 1, right: 0})).toBe("B4")
        expect(boxToRange(origin, {top: 1, left: 0, bottom: 2, right: 1})).toBe("B4:C5")
    })

    it("decodes a range back to the box, or null before the origin", () => {
        expect(rangeToBox(origin, "B4:C5")).toEqual({top: 1, left: 0, bottom: 2, right: 1})
        expect(rangeToBox(origin, "A1")).toBeNull()
    })

    it("crosses the Z to AA column boundary both ways", () => {
        const a1 = {r: 0, c: 0}
        expect(boxToRange(a1, {top: 0, left: 25, bottom: 9, right: 27})).toBe("Z1:AB10")
        expect(rangeToBox(a1, "Z1:AB10")).toEqual({top: 0, left: 25, bottom: 9, right: 27})
    })

    it("rejects a malformed range", () => {
        expect(rangeToBox({r: 0, c: 0}, "B0")).toBeNull()
        expect(rangeToBox({r: 0, c: 0}, "4B")).toBeNull()
    })
})

describe("zip bomb guard", () => {
    it("reads the declared uncompressed size from the central directory", () => {
        const zip = zipSync({"a.xml": new Uint8Array(1000), "b.xml": new Uint8Array(234)})
        expect(zipUnpackedSize(zip)).toBe(1234)
    })

    it("refuses a workbook that unpacks over 100x its size before parsing", () => {
        const bomb = zipSync({"xl/worksheets/sheet1.xml": new Uint8Array(5_000_000)})
        let error: unknown
        try {
            parseWorkbook(bomb)
        } catch (e) {
            error = e
        }
        expect(error).toBeInstanceOf(UnpackTooLarge)
        expect((error as UnpackTooLarge).unpackedBytes).toBe(5_000_000)
    })

    it("lets a real workbook through", () => {
        expect(parseWorkbook(fixture("openpyxl-formulas.xlsx")).sheets.length).toBeGreaterThan(0)
    })

    it("treats an unreadable central directory as not a workbook", () => {
        const truncated = zipSync({"a.xml": new Uint8Array(10)}).slice(0, 30)
        expect(() => parseWorkbook(truncated)).toThrow("not a workbook")
    })
})
