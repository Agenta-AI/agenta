import {act} from "react"

import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it} from "vitest"

import {SheetFooter, SheetGrid} from "../../src/drive/SheetGrid"
import type {Sheet} from "../../src/drive/workbook"

// The used range starts at B3, so rows[r][c] is the sheet cell at row 3 + r, column B + c.
const sheet: Sheet = {
    name: "Q3",
    origin: {r: 2, c: 1},
    truncated: {rows: false, totalColumns: null},
    rows: [
        [{value: "Region"}, {value: "Total"}],
        [{value: "North"}, {value: "260", formula: "=B4+C4", numeric: true}],
        [{value: "West"}, {formula: "=B5+C5"}],
        [{value: "Share"}, {value: "25.6%", numeric: true, raw: "0.256"}],
    ],
}

let container: HTMLDivElement
let root: Root

beforeEach(() => {
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
    act(() => root.render(<SheetGrid rows={sheet.rows} origin={sheet.origin} />))
})

afterEach(() => {
    act(() => root.unmount())
    container.remove()
})

const cell = (r: number, c: number) =>
    container.querySelector<HTMLElement>(`[data-row="${r}"][data-col="${c}"]`)!
const formulaBar = () => container.firstElementChild!.firstElementChild!.textContent

describe("SheetGrid", () => {
    it("labels columns and rows in the sheet's own coordinates", () => {
        const [letters, firstRow] = container.querySelectorAll("tr")
        expect([...letters.cells].slice(1, 3).map((th) => th.textContent)).toEqual(["B", "C"])
        expect(firstRow.cells[0].textContent).toBe("3")
    })

    it("shows the clicked cell's address and formula in the formula bar", () => {
        act(() => cell(1, 1).click())
        expect(formulaBar()).toBe("C4fx=B4+C4")
        expect(cell(1, 1).className).toContain("text-right")
        act(() => cell(2, 0).click())
        expect(formulaBar()).toBe("B5fxWest")
        act(() => cell(3, 1).click())
        expect(formulaBar()).toBe("C6fx0.256")
    })

    it("clears the selection when the file's rows change", () => {
        act(() => cell(1, 1).click())
        act(() => root.render(<SheetGrid rows={[...sheet.rows]} origin={sheet.origin} />))
        expect(formulaBar()).toBe("fx")
    })

    it("shows a row that runs wider than the first row", () => {
        const wide = Array.from({length: 10}, (_, c) => ({value: `v${c}`}))
        act(() => root.render(<SheetGrid rows={[sheet.rows[0], wide]} origin={{r: 0, c: 0}} />))
        expect(cell(1, 9).textContent).toBe("v9")
        act(() => cell(1, 9).click())
        expect(formulaBar()).toBe("J2fxv9")
    })

    it("pads the grid without making the padding selectable", () => {
        expect(container.querySelectorAll("tbody tr")).toHaveLength(30)
        expect(container.querySelectorAll("[data-row]")).toHaveLength(8)
    })
})

describe("SheetFooter", () => {
    it("names the sheet's size, or what the caps cut", () => {
        act(() => root.render(<SheetFooter sheet={sheet} />))
        expect(container.textContent).toBe("4 rows · 2 columns")
        act(() =>
            root.render(
                <SheetFooter sheet={{...sheet, truncated: {rows: true, totalColumns: 90}}} />,
            ),
        )
        expect(container.textContent).toBe(
            "Showing the first 4 rows and 2 of 90 columns; download for the full file.",
        )
    })
})
