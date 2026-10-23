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
        const {markdown, ...model} = tableModel(providers)
        expect(markdown).toEqual({header: model.header, rows: model.rows})
        expect(model).toEqual({
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

    it("keeps link destinations, and leaves a bare URL bare", () => {
        const link = (text: string, href: string): HastNode => ({
            type: "element",
            tagName: "a",
            properties: {href},
            children: [{type: "text", value: text}],
        })
        const tbody = table(["Source"], [["docs"], ["https://agenta.ai"]])
        const [docs, bare] = tbody.children![1].children!.map((tr) => tr.children![0])
        docs.children = [link("Agenta docs", "https://agenta.ai/docs")]
        bare.children = [link("https://agenta.ai", "https://agenta.ai")]
        const linked = tableModel(tbody)
        expect(linked.rows).toEqual([["Agenta docs"], ["https://agenta.ai"]])
        expect(toMarkdown(linked)).toBe(
            "| Source |\n| --- |\n| [Agenta docs](https://agenta.ai/docs) |\n| https://agenta.ai |",
        )
    })

    it("encodes spaces and parentheses in a link destination", () => {
        const tbody = table(["Source"], [["x"]])
        const cell = tbody.children![1].children![0].children![0]
        cell.children = [
            {
                type: "element",
                tagName: "a",
                properties: {href: "https://example.com/my file (1)"},
                children: [{type: "text", value: "file"}],
            },
        ]
        expect(toMarkdown(tableModel(tbody))).toBe(
            "| Source |\n| --- |\n| [file](https://example.com/my%20file%20%281%29) |",
        )
    })

    it("escapes a backslash before a pipe so the pipe stays in its cell", () => {
        const model = tableModel(table(["Path"], [["C:\\ | D:"]]))
        expect(toMarkdown(model)).toBe("| Path |\n| --- |\n| C:\\\\ \\| D: |")
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
            table(
                ["Cell", "Delta"],
                [
                    ['=HYPERLINK("http://x")', "-5"],
                    ["@SUM(A1)", "+1.5%"],
                ],
            ),
        )
        expect(toCsv(model)).toBe(
            'Cell,Delta\r\n"\'=HYPERLINK(""http://x"")",-5\r\n\'@SUM(A1),+1.5%',
        )
    })

    it("defuses the full-width formula marks", () => {
        const model = tableModel(table(["Cell"], [["＝SUM(A1)"], ["＋1"], ["－A1"], ["＠x"]]))
        expect(toCsv(model)).toBe("Cell\r\n'＝SUM(A1)\r\n'＋1\r\n'－A1\r\n'＠x")
    })
})
