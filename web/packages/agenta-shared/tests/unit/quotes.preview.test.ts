import {describe, expect, it} from "vitest"

import {
    cellsToTable,
    formatPreviewChipLocation,
    inlineCode,
    previewCommentNumber,
    quotesToMarkdown,
    readableQuoteText,
    splitQuotedMessage,
    type PreviewAnchor,
    type Quote,
} from "../../src/quotes"

const previewQuote = (anchor: PreviewAnchor, text: string, note: string): Quote => ({
    id: "c1",
    text,
    note,
    staged: true,
    stale: false,
    source: {
        kind: "preview",
        path: "app/index.html",
        displayPath: "agent-files/app/index.html",
        fileName: "index.html",
        anchor,
    },
})

const element = (over: Partial<PreviewAnchor & {type: "element"}>): PreviewAnchor => ({
    type: "element",
    format: "html",
    selector: "main > h2:nth-of-type(2)",
    tag: "h2",
    point: {x: 0.5, y: 0.5},
    ...over,
})

describe("inlineCode", () => {
    it("wraps plain text in single backticks", () => {
        expect(inlineCode("Q3")).toBe("`Q3`")
    })

    it("uses a fence one longer than the longest run inside", () => {
        expect(inlineCode("a ``b`` c")).toBe("```a ``b`` c```")
    })

    it("pads content that starts or ends with a backtick", () => {
        expect(inlineCode("`x")).toBe("`` `x ``")
    })

    it("pads content with a space at both ends so neither space is stripped", () => {
        expect(inlineCode(" a ")).toBe("`  a  `")
    })

    it("turns line breaks into spaces", () => {
        expect(inlineCode("a\nb\r\nc")).toBe("`a b c`")
    })
})

describe("cellsToTable", () => {
    it("takes the first row as the header when none is given", () => {
        expect(
            cellsToTable(null, [
                ["Region", "Revenue"],
                ["EU", "40"],
            ]),
        ).toBe("| Region | Revenue |\n| --- | --- |\n| EU | 40 |")
    })

    it("puts a separate header on top, escapes pipes and flattens line breaks", () => {
        expect(cellsToTable(["Name", "Notes"], [["a|b", "line 1\nline 2"]])).toBe(
            "| Name | Notes |\n| --- | --- |\n| a\\|b | line 1 line 2 |",
        )
    })

    it("escapes backslashes so a trailing one cannot escape the cell's pipe", () => {
        expect(cellsToTable(["Path"], [["C:\\dir\\"]])).toBe("| Path |\n| --- |\n| C:\\\\dir\\\\ |")
    })

    it("pads short rows to the widest row", () => {
        expect(cellsToTable(["A"], [["1", "2"]])).toBe("| A |  |\n| --- | --- |\n| 1 | 2 |")
    })
})

describe("formatPreviewChipLocation", () => {
    it("names the short location per format", () => {
        expect(formatPreviewChipLocation(element({}))).toBe("<h2>")
        expect(formatPreviewChipLocation(element({format: "document", page: 3}))).toBe("p. 3")
        const block = (kind: "paragraph" | "table", index: number) =>
            element({format: "document", page: 1, block: {kind, index}})
        expect(formatPreviewChipLocation(block("paragraph", 12))).toBe("¶ 12")
        expect(formatPreviewChipLocation(block("table", 2))).toBe("table 2")
        expect(formatPreviewChipLocation(element({format: "presentation", page: 2}))).toBe(
            "slide 2",
        )
        expect(formatPreviewChipLocation({type: "cells", sheet: "Q3", range: "B4:C5"})).toBe(
            "Q3!B4:C5",
        )
        expect(formatPreviewChipLocation({type: "cells", range: "B4:C5"})).toBe("B4:C5")
    })
})

describe("quotesToMarkdown for preview comments", () => {
    it("heads an HTML comment with the selector and adds the opening tag", () => {
        const quote = previewQuote(
            element({openTag: '<h2 class="title">'}),
            "Pricing",
            "Make this bigger.",
        )
        expect(quotesToMarkdown([quote])).toBe(
            '> **`agent-files/app/index.html`** (element `main > h2:nth-of-type(2)`)  \n> Pricing\n> `<h2 class="title">`\n\nMake this bigger.',
        )
    })

    it("heads a DOCX comment with the page", () => {
        const quote = previewQuote(
            element({format: "document", selector: "p:nth-of-type(4)", tag: "p", page: 3}),
            "Revenue grew.",
            "Cite the source.",
        )
        expect(quotesToMarkdown([quote])).toBe(
            "> **`agent-files/app/index.html`** (page 3)  \n> Revenue grew.\n\nCite the source.",
        )
    })

    it("heads a PPTX comment with the slide", () => {
        const quote = previewQuote(
            element({format: "presentation", selector: ":scope > :nth-child(3)", page: 3}),
            "Q3 revenue grew 40%",
            "Say 41%.",
        )
        expect(quotesToMarkdown([quote])).toBe(
            "> **`agent-files/app/index.html`** (slide 3)  \n> Q3 revenue grew 40%\n\nSay 41%.",
        )
    })

    it("heads a spreadsheet comment with the sheet and range and quotes the table", () => {
        const table = cellsToTable(["Region", "Revenue"], [["EU", "40"]])
        const quote = previewQuote({type: "cells", sheet: "Q3", range: "B4:C4"}, table, "Check.")
        expect(quotesToMarkdown([quote])).toBe(
            "> **`agent-files/app/index.html`** (sheet `Q3`, B4:C4)  \n> | Region | Revenue |\n> | --- | --- |\n> | EU | 40 |\n\nCheck.",
        )
    })
})

describe("CSV comments", () => {
    it("head a CSV range without a sheet and read back as a card", () => {
        const quote = previewQuote({type: "cells", range: "B2"}, "| Q1 |\n| --- |\n| 120 |", "")
        const markdown = quotesToMarkdown([quote])
        expect(markdown.split("\n")[0]).toBe("> **`agent-files/app/index.html`** (cells B2)  ")
        expect(splitQuotedMessage(markdown).quotes).toEqual([
            {origin: "agent-files/app/index.html", text: "| Q1 |\n| --- |\n| 120 |"},
        ])
    })
})

describe("splitQuotedMessage reads preview comments back", () => {
    it("lifts a preview head into a quote card", () => {
        const quote = previewQuote(
            element({format: "presentation", page: 3}),
            "Q3 revenue grew 40%",
            "",
        )
        expect(splitQuotedMessage(quotesToMarkdown([quote], "Fix it"))).toEqual({
            quotes: [
                {
                    origin: "agent-files/app/index.html",
                    text: "Q3 revenue grew 40%",
                },
            ],
            text: "Fix it",
        })
    })

    it("survives a sheet name with quotes and parentheses", () => {
        const quote = previewQuote(
            {type: "cells", sheet: 'Q3 "final" (v2)', range: "A1"},
            "| x |\n| --- |",
            "",
        )
        const {quotes} = splitQuotedMessage(quotesToMarkdown([quote]))
        expect(quotes).toEqual([
            {
                origin: "agent-files/app/index.html",
                text: "| x |\n| --- |",
            },
        ])
    })

    it("survives an opening tag with a backtick in an attribute", () => {
        const quote = previewQuote(element({openTag: '<p title="a`b">'}), "Hi", "")
        const {quotes} = splitQuotedMessage(quotesToMarkdown([quote]))
        expect(quotes).toEqual([
            {
                origin: "agent-files/app/index.html",
                text: 'Hi\n``<p title="a`b">``',
            },
        ])
    })

    it("lifts a Word paragraph head into a quote card", () => {
        const quote = previewQuote(
            element({format: "document", block: {kind: "paragraph", index: 12}}),
            "Revenue grew in every region.",
            "",
        )
        const markdown = quotesToMarkdown([quote], "Name them")
        expect(markdown.split("\n", 1)[0]).toBe(
            "> **`agent-files/app/index.html`** (paragraph 12)  ",
        )
        expect(splitQuotedMessage(markdown)).toEqual({
            quotes: [{origin: "agent-files/app/index.html", text: "Revenue grew in every region."}],
            text: "Name them",
        })
    })

    it("still reads a text quote's line range head", () => {
        const markdown = "> **`a.md`** (L3)  \n> hello"
        expect(splitQuotedMessage(markdown).quotes).toEqual([{origin: "a.md", text: "hello"}])
    })
})

describe("previewCommentNumber", () => {
    const on = (id: string, path: string, staged = true): Quote => ({
        id,
        text: "x",
        note: "",
        staged,
        stale: false,
        source: {kind: "preview", path, displayPath: path, fileName: path, anchor: element({})},
    })

    it("counts staged comments on the same document in store order", () => {
        const quotes = [
            on("a", "deck.pptx"),
            on("b", "memo.docx"),
            on("c", "deck.pptx"),
            on("d", "deck.pptx", false),
        ]
        expect(quotes.map((q) => previewCommentNumber(quotes, q))).toEqual([1, 1, 2, null])
    })

    it("has no number for a text quote", () => {
        const text: Quote = {
            id: "t",
            text: "x",
            note: "",
            staged: true,
            stale: false,
            source: {kind: "message", messageId: "m"},
        }
        expect(previewCommentNumber([text], text)).toBeNull()
    })
})

describe("readableQuoteText", () => {
    const cells = (rows: string[][]) =>
        previewQuote({type: "cells", sheet: "Q3", range: "C5"}, cellsToTable(null, rows), "")

    it("reads one cell under its header as name: value", () => {
        expect(readableQuoteText(cells([["Plan"], ["80"]]))).toBe("Plan: 80")
    })

    it("pairs each header with its value for one row", () => {
        expect(
            readableQuoteText(
                cells([
                    ["Plan", "Actual"],
                    ["80", "9|1"],
                ]),
            ),
        ).toBe("Plan: 80, Actual: 9|1")
    })

    it("joins cells with dots and rows with slashes for a block", () => {
        expect(
            readableQuoteText(
                cells([
                    ["A", "B"],
                    ["1", "2"],
                    ["3", "4"],
                ]),
            ),
        ).toBe("A · B / 1 · 2 / 3 · 4")
    })

    it("leaves an element quote unchanged", () => {
        expect(readableQuoteText(previewQuote(element({}), "Pricing | plans", ""))).toBe(
            "Pricing | plans",
        )
    })
})
