import {readFileSync} from "node:fs"
import {join} from "node:path"

import {describe, expect, it} from "vitest"
import {utils, write} from "xlsx"

import {COL_CAP, parseWorkbook, ROW_CAP} from "../../src/drive/workbook"

const fixture = (name: string) => readFileSync(join(__dirname, "../fixtures/office", name))

const book = (sheets: Record<string, ReturnType<typeof utils.aoa_to_sheet>>): Uint8Array => {
    const wb = utils.book_new()
    for (const [name, sheet] of Object.entries(sheets)) utils.book_append_sheet(wb, sheet, name)
    return new Uint8Array(write(wb, {type: "array", bookType: "xlsx"}) as ArrayBuffer)
}

describe("parseWorkbook", () => {
    it("shows the stored value of a formula cell saved by a spreadsheet app", () => {
        const sheet = utils.aoa_to_sheet([
            ["Region", "Q1", "Q2", "Total"],
            ["North", 120, 140],
        ])
        sheet.D2 = {t: "n", v: 260, f: "B2+C2"}
        const {sheets} = parseWorkbook(book({Sales: sheet}))
        expect(sheets[0].rows).toEqual([
            [{value: "Region"}, {value: "Q1"}, {value: "Q2"}, {value: "Total"}],
            [{value: "North"}, {value: "120"}, {value: "140"}, {value: "260"}],
        ])
    })

    it("shows the formula of an openpyxl cell with no stored value, in sheet order", () => {
        const {sheets} = parseWorkbook(fixture("openpyxl-formulas.xlsx"))
        expect(sheets.map((s) => s.name)).toEqual(["Sales", "Notes"])
        expect(sheets[0].rows[3]).toEqual([
            {value: "West"},
            {value: "75"},
            {value: "80"},
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
                [{value: "Ada"}, {value: "9"}],
            ],
            truncated: {rows: false, totalColumns: null},
        })
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
