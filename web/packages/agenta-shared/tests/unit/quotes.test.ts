import {describe, expect, it} from "vitest"

import {
    findInSource,
    formatLineRange,
    normalizeQuoteText,
    quotesToMarkdown,
    truncateQuoteText,
    QUOTE_EXCERPT_CAP,
    type Quote,
} from "../../src/quotes"

const fileQuote = (over: Partial<Quote> = {}): Quote => ({
    id: "q1",
    text: "A schedule runs one pinned variant and revision.",
    note: "This contradicts the section above.",
    staged: true,
    stale: false,
    source: {
        kind: "file",
        path: "docs/07-schedule.mdx",
        displayPath: "agent-files/docs/07-schedule.mdx",
        fileName: "07-schedule.mdx",
        startLine: 34,
        endLine: 36,
    },
    ...over,
})

describe("normalizeQuoteText", () => {
    it("collapses every whitespace run and trims", () => {
        expect(normalizeQuoteText("  a\n\n  b\tc  ")).toBe("a b c")
    })
})

describe("truncateQuoteText", () => {
    it("leaves a short excerpt alone", () => {
        expect(truncateQuoteText("short")).toBe("short")
    })

    it("cuts on a word boundary and marks the elision", () => {
        const out = truncateQuoteText("alpha bravo charlie delta echo foxtrot", 20)
        expect(out.endsWith("…")).toBe(true)
        expect(out.length).toBeLessThanOrEqual(21)
        expect(out).not.toContain("bravocharlie")
    })
})

describe("findInSource", () => {
    const source = "line one\nline two has the answer\nline three\n"

    it("finds an exact match and reports its line", () => {
        const hit = findInSource(source, "has the answer")
        expect(hit).toMatchObject({startLine: 2, endLine: 2})
    })

    it("spans the lines a multi-line match covers", () => {
        const hit = findInSource(source, "line two has the answer\nline three")
        expect(hit).toMatchObject({startLine: 2, endLine: 3})
    })

    it("falls back to a whitespace-normalised match across a rendered line break", () => {
        // The rendered selection lost the source's hard wrap.
        const hit = findInSource("a paragraph that\nwraps here", "a paragraph that wraps here")
        expect(hit).toMatchObject({startLine: 1, endLine: 2})
    })

    it("returns null when the excerpt is not in the source", () => {
        expect(findInSource(source, "nowhere at all")).toBeNull()
        expect(findInSource("", "x")).toBeNull()
        expect(findInSource(source, "   ")).toBeNull()
    })
})

describe("formatLineRange", () => {
    it("renders a single line, a range, and nothing", () => {
        expect(formatLineRange(34, 34)).toBe("L34")
        expect(formatLineRange(34, 36)).toBe("L34–L36")
        expect(formatLineRange(34)).toBe("L34")
        expect(formatLineRange(undefined, 5)).toBe("")
    })
})

describe("quotesToMarkdown", () => {
    it("returns the text untouched when nothing is staged", () => {
        expect(quotesToMarkdown([], "hello")).toBe("hello")
    })

    it("carries the file name, line range, excerpt and note", () => {
        const out = quotesToMarkdown([fileQuote()], "Fix these three.")
        expect(out).toContain("> **07-schedule.mdx** (L34–L36)  ")
        expect(out).toContain("> A schedule runs one pinned variant and revision.")
        expect(out).toContain("This contradicts the section above.")
        expect(out.endsWith("Fix these three.")).toBe(true)
    })

    it("labels a message quote by its turn", () => {
        const out = quotesToMarkdown([
            fileQuote({
                source: {kind: "message", messageId: "m1", turnLabel: "Agent reply"},
                note: "",
            }),
        ])
        expect(out).toContain("> **Agent reply**  ")
    })

    it("stacks several quotes above one message", () => {
        const out = quotesToMarkdown([fileQuote(), fileQuote({id: "q2", note: "And this."})], "go")
        expect(out.match(/> \*\*07-schedule\.mdx\*\*/g)).toHaveLength(2)
    })

    it("caps a runaway excerpt so a dragged code block cannot inflate the prompt", () => {
        const out = quotesToMarkdown([fileQuote({text: "x".repeat(QUOTE_EXCERPT_CAP + 500)})])
        expect(out).toContain("… (excerpt truncated)")
        expect(out.length).toBeLessThan(QUOTE_EXCERPT_CAP + 400)
    })

    it("quotes every line of a multi-line excerpt", () => {
        const out = quotesToMarkdown([fileQuote({text: "one\ntwo", note: ""})])
        expect(out).toContain("> one\n> two")
    })
})
