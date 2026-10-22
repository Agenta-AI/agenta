import {act} from "react"

import {clearSessionQuotes, getQuotes} from "@agenta/ui/quote-selection"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it} from "vitest"

import {DriveSessionProvider} from "../../src/drive/driveSessionContext"
import {DriveToolbar} from "../../src/drive/DriveToolbar"
import {PreviewCommentModeProvider} from "../../src/drive/previewCommentMode"
import {SpreadsheetView} from "../../src/drive/renderers"
import * as addressing from "../../src/drive/workbook"
import type {Workbook} from "../../src/drive/workbook"

class StubResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
}
globalThis.ResizeObserver ??= StubResizeObserver as unknown as typeof ResizeObserver

const sessionId = "sheet-comment-session"
const target = {path: "q3.xlsx", displayPath: "agent-files/q3.xlsx", fileName: "q3.xlsx"}

// The used range starts at B3, so rows[r][c] is the sheet cell at row 3 + r, column B + c.
const book = (north = "North"): Workbook => ({
    sheets: [
        {
            name: "Q3",
            origin: {r: 2, c: 1},
            truncated: {rows: false, totalColumns: null},
            rows: [
                [{value: "Region"}, {value: "Q1"}, {value: "Q2"}],
                [{value: north}, {value: "120"}, {value: "140"}],
                [{value: "South"}, {value: "90"}, {value: "95"}],
                [{value: "West"}, {value: "75"}, {formula: "=B4+C4"}],
            ],
        },
    ],
})

let container: HTMLDivElement
let root: Root

beforeEach(() => {
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
})

afterEach(() => {
    act(() => root.unmount())
    container.remove()
    clearSessionQuotes(sessionId)
})

const show = (workbook: Workbook) =>
    act(() =>
        root.render(
            <DriveSessionProvider sessionId={sessionId}>
                <PreviewCommentModeProvider fileKey="q3">
                    <DriveToolbar variant="other" path={target.path} previewKind="spreadsheet" />
                    <SpreadsheetView workbook={workbook} addressing={addressing} target={target} />
                </PreviewCommentModeProvider>
            </DriveSessionProvider>,
        ),
    )

const startCommenting = (workbook: Workbook) => {
    show(workbook)
    act(() => container.querySelector<HTMLButtonElement>('button[aria-label="Comment"]')?.click())
}

const cell = (row: number, col: number) => {
    const found = container.querySelector(`[data-row="${row}"][data-col="${col}"]`)
    if (!found) throw new Error(`no cell ${row},${col}`)
    return found
}

const select = (from: [number, number], to: [number, number] = from, shiftKey = false) => {
    act(() => {
        cell(...from).dispatchEvent(
            new MouseEvent("pointerdown", {bubbles: true, button: 0, shiftKey}),
        )
    })
    act(() => {
        cell(...to).dispatchEvent(new MouseEvent("pointerover", {bubbles: true}))
    })
    act(() => {
        window.dispatchEvent(new MouseEvent("pointerup"))
    })
}

const stage = () => {
    const note = container.querySelector("textarea")
    if (!note) throw new Error("note box is not open")
    act(() => {
        note.dispatchEvent(new KeyboardEvent("keydown", {key: "Enter", bubbles: true}))
    })
}

const staged = () =>
    getQuotes(sessionId).map((quote) => ({
        anchor: quote.source.kind === "preview" ? quote.source.anchor : null,
        text: quote.text,
    }))

describe("spreadsheet comments", () => {
    it("names one clicked cell in the sheet's own coordinates", () => {
        startCommenting(book())
        // rows[1][0] with origin {r: 2, c: 1}: sheet row 2 + 1 + 1 = 4, column 1 + 0 = B.
        select([1, 0])
        stage()
        expect(staged()).toEqual([
            {
                anchor: {type: "cells", sheet: "Q3", range: "B4"},
                text: "| Region |\n| --- |\n| North |",
            },
        ])
    })

    it("quotes a dragged 2x2 range under the sheet's header row", () => {
        startCommenting(book())
        select([1, 0], [2, 1])
        stage()
        expect(staged()).toEqual([
            {
                anchor: {type: "cells", sheet: "Q3", range: "B4:C5"},
                text: "| Region | Q1 |\n| --- | --- |\n| North | 120 |\n| South | 90 |",
            },
        ])
    })

    it("adds no extra header when the selection includes the first row", () => {
        startCommenting(book())
        select([0, 0], [1, 1])
        stage()
        expect(staged()).toEqual([
            {
                anchor: {type: "cells", sheet: "Q3", range: "B3:C4"},
                text: "| Region | Q1 |\n| --- | --- |\n| North | 120 |",
            },
        ])
    })

    it("extends from the anchor cell on Shift+click, quoting a formula as its text", () => {
        startCommenting(book())
        select([2, 1])
        select([3, 2], [3, 2], true)
        stage()
        expect(staged()).toEqual([
            {
                anchor: {type: "cells", sheet: "Q3", range: "C5:D6"},
                text: "| Q1 | Q2 |\n| --- | --- |\n| 90 | 95 |\n| 75 | =B4+C4 |",
            },
        ])
    })

    it("marks a comment changed when its cells hold other values, and clears it when they return", () => {
        startCommenting(book())
        select([1, 0])
        stage()
        expect(getQuotes(sessionId)[0].stale).toBe(false)
        show(book("East"))
        expect(getQuotes(sessionId)[0].stale).toBe(true)
        show(book())
        expect(getQuotes(sessionId)[0].stale).toBe(false)
    })

    it("marks a comment changed when its sheet is gone", () => {
        startCommenting(book())
        select([1, 0])
        stage()
        show({sheets: [{...book().sheets[0], name: "Q4"}]})
        expect(getQuotes(sessionId)[0].stale).toBe(true)
    })
})
