import {describe, expect, it} from "vitest"

import {
    cellLayouts,
    isNumericCell,
    tableModel,
    toCsv,
    toMarkdown,
    type HastNode,
} from "../../src/components/chatTableModel"

let line = 0
const cell = (tag: "th" | "td", text: string, column: number): HastNode => ({
    type: "element",
    tagName: tag,
    position: {start: {line, column}},
    children: [{type: "text", value: text}],
})
const row = (tag: "th" | "td", texts: string[]): HastNode => {
    line += 1
    return {type: "element", tagName: "tr", children: texts.map((t, i) => cell(tag, t, i * 10 + 1))}
}
const table = (header: string[], body: string[][]): HastNode => {
    line = 0
    return {
        type: "element",
        tagName: "table",
        children: [
            {type: "element", tagName: "thead", children: [row("th", header)]},
            {type: "element", tagName: "tbody", children: body.map((r) => row("td", r))},
        ],
    }
}

describe("isNumericCell", () => {
    it.each(["~2–4s", "$0.111", "10.3%", "1,204", "20–40s", "4–9 min", "3x", "$1.20 / hr"])(
        "reads %s as a number",
        (text) => expect(isNumericCell(text)).toBe(true),
    )
    it.each(["Minutes", "Yes", "whisper-large-v3", "High CPU/RAM", "2026-10-22", ""])(
        "reads %s as text",
        (text) => expect(isNumericCell(text)).toBe(false),
    )
})

describe("tableModel", () => {
    const providers = table(
        ["Provider", "Latency", "Price / hr", "Notes"],
        [
            ["Groq", "2–4s", "$0.111", "whisper-large-v3 on LPU"],
            [
                "Local Whisper",
                "4–9 min",
                "—",
                "CPU-bound in the sandbox, which is slow on long videos",
            ],
        ],
    )

    it("reads header, rows and a layout per column", () => {
        expect(tableModel(providers)).toEqual({
            header: ["Provider", "Latency", "Price / hr", "Notes"],
            rows: [
                ["Groq", "2–4s", "$0.111", "whisper-large-v3 on LPU"],
                [
                    "Local Whisper",
                    "4–9 min",
                    "—",
                    "CPU-bound in the sandbox, which is slow on long videos",
                ],
            ],
            columns: [
                {numeric: false, prose: false},
                {numeric: true, prose: false},
                {numeric: true, prose: false},
                {numeric: false, prose: true},
            ],
        })
    })

    it("does not call an all-empty column numeric, and pads a short row", () => {
        const model = tableModel(table(["A", "B"], [["x", "—"], ["y"]]))
        expect(model.rows).toEqual([
            ["x", "—"],
            ["y", ""],
        ])
        expect(model.columns[1]).toEqual({numeric: false, prose: false})
    })

    it("keeps a column numeric through one stray label row, not one that is mostly text", () => {
        const model = tableModel(
            table(
                ["Region", "Q1", "Note"],
                [
                    ["Region", "Q1", "x"],
                    ["North", "120", "7"],
                    ["South", "90", "y"],
                ],
            ),
        )
        expect(model.columns.map((column) => column.numeric)).toEqual([false, true, false])
    })

    it("keys each cell's layout by its source position", () => {
        const layouts = cellLayouts(providers, tableModel(providers))
        expect(layouts.get("1:1")).toEqual({numeric: false, prose: false, first: true})
        expect(layouts.get("2:11")).toEqual({numeric: true, prose: false, first: false})
        expect(layouts.get("3:31")).toEqual({numeric: false, prose: true, first: false})
        expect(layouts.size).toBe(12)
    })
})

describe("toMarkdown", () => {
    it("writes a GFM table, right-aligning numeric columns and escaping pipes", () => {
        const model = tableModel(table(["Name", "Cost"], [["a | b", "$1"]]))
        expect(toMarkdown(model)).toBe("| Name | Cost |\n| --- | ---: |\n| a \\| b | $1 |")
    })
})

describe("toCsv", () => {
    it("quotes fields with commas, quotes or line breaks, and ends rows with CRLF", () => {
        const model = tableModel(
            table(
                ["Name", "Note"],
                [
                    ["plain", 'say "hi", then go'],
                    ["multi\nline", "1,204"],
                ],
            ),
        )
        expect(toCsv(model)).toBe(
            'Name,Note\r\nplain,"say ""hi"", then go"\r\n"multi\nline","1,204"',
        )
    })

    it("defuses formula cells but keeps signed numbers", () => {
        const model = tableModel(
            table(["Cell", "Delta"], [['=HYPERLINK("http://x")', "-5"], ["@SUM(A1)", "+1.5%"]]),
        )
        expect(toCsv(model)).toBe(
            'Cell,Delta\r\n"\'=HYPERLINK(""http://x"")",-5\r\n\'@SUM(A1),+1.5%',
        )
    })
})
