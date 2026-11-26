import {describe, expect, it} from "vitest"

import {listTableToCsv} from "../../src/list-table/csv"
import type {ListTableCsvColumn} from "../../src/list-table/types"

interface Row {
    name: string
    count: number | null
}

const COLUMNS: ListTableCsvColumn<Row>[] = [
    {label: "Name", value: (row) => row.name},
    {label: "Count", value: (row) => row.count},
]

describe("CSV export of a list", () => {
    it.each([
        ["a plain value as is", "Alpha", "Alpha"],
        ["a value with a comma in quotes", "Alpha, Beta", '"Alpha, Beta"'],
        ["a value with a quote in quotes with the quote doubled", 'Say "hi"', '"Say ""hi"""'],
        ["a value with a line break in quotes", "Line one\nLine two", '"Line one\nLine two"'],
        ["a value with a carriage return in quotes", "One\r\nTwo", '"One\r\nTwo"'],
        ["a value that starts like a formula as text", "=SUM(A1)", "'=SUM(A1)"],
        ["a formula-like value with a comma as quoted text", "@x,y", '"\'@x,y"'],
    ])("writes %s", (_case, name, expected) => {
        expect(listTableToCsv([{name, count: 1}], COLUMNS)).toBe(`Name,Count\r\n${expected},1`)
    })

    it("writes negative numbers as numbers and missing values as empty fields", () => {
        expect(
            listTableToCsv(
                [
                    {name: "Alpha", count: -5},
                    {name: "Beta", count: null},
                ],
                COLUMNS,
            ),
        ).toBe("Name,Count\r\nAlpha,-5\r\nBeta,")
    })

    it("writes a value the row does not have as an empty field", () => {
        expect(
            listTableToCsv([{name: "Alpha", count: 1}], [{label: "Note", value: () => undefined}]),
        ).toBe("Note\r\n")
    })

    it("writes only the header line for an empty list", () => {
        expect(listTableToCsv([], COLUMNS)).toBe("Name,Count")
    })

    it("quotes a header label that holds a comma", () => {
        expect(listTableToCsv([], [{label: "Name, full", value: () => ""}])).toBe('"Name, full"')
    })
})
