import {describe, expect, it} from "vitest"

import {
    findInSource,
    formatLineRange,
    locateQuote,
    normalizeQuoteText,
    quotesToMarkdown,
    refreshFileQuote,
    relocateQuote,
    tidyQuoteText,
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

describe("tidyQuoteText", () => {
    it("keeps line breaks and indentation", () => {
        expect(tidyQuoteText("steps:\n  - run: build\n  - run: test")).toBe(
            "steps:\n  - run: build\n  - run: test",
        )
    })

    it("trims trailing whitespace per line and folds blank-line runs", () => {
        expect(tidyQuoteText("\n\n  a  \r\n\n\n\n  b\t\n\n")).toBe("  a\n\n  b")
    })

    it("reduces a whitespace-only selection to nothing", () => {
        expect(tidyQuoteText(" \n\t \n")).toBe("")
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

    it("returns null rather than guessing when the excerpt repeats", () => {
        expect(findInSource("retry: 3\nname: a\nretry: 3\n", "retry: 3")).toBeNull()
    })
})

describe("locateQuote", () => {
    const source = "jobs:\n  build:\n    retry: 3\n  test:\n    retry: 3\n"
    // What the rendered body reads, whitespace dropped, before each `retry: 3`.
    const rendered = source
    const beforeSecond = source.slice(0, source.lastIndexOf("retry"))

    it("picks the occurrence the user selected, not the first", () => {
        const hit = locateQuote(source, "retry: 3", {before: beforeSecond, rendered})
        expect(hit).toMatchObject({startLine: 5, endLine: 5})
        const first = locateQuote(source, "retry: 3", {
            before: source.slice(0, source.indexOf("retry")),
            rendered,
        })
        expect(first).toMatchObject({startLine: 3, endLine: 3})
    })

    it("spans a multi-line selection", () => {
        const hit = locateQuote(source, "test:\n    retry: 3", {
            before: source.slice(0, source.indexOf("test")),
            rendered,
        })
        expect(hit).toMatchObject({startLine: 4, endLine: 5})
    })

    it("maps a body that renders line breaks as <br> (no newline characters)", () => {
        const flat = source.replace(/\n/g, "")
        const hit = locateQuote(source, "retry: 3", {
            before: flat.slice(0, flat.lastIndexOf("retry")),
            rendered: flat,
        })
        expect(hit).toMatchObject({startLine: 5, endLine: 5})
    })

    it("maps pretty-printed JSON back to the raw file's lines", () => {
        const raw = '{"a":1,\n"b":{"c":2}}'
        const pretty = JSON.stringify(JSON.parse(raw), null, 2)
        const hit = locateQuote(raw, '"c": 2', {
            before: pretty.slice(0, pretty.indexOf('"c"')),
            rendered: pretty,
        })
        expect(hit).toMatchObject({startLine: 2, endLine: 2})
    })

    it("gives a repeated excerpt no range when the rendered body is not the source", () => {
        const markdown = "- **retry** 3\n- retry 3\n- retry 3\n"
        const shown = "retry 3\nretry 3\nretry 3"
        expect(locateQuote(markdown, "retry 3", {before: "", rendered: shown})).toBeNull()
    })

    it("still trusts a unique verbatim match in a rendered body", () => {
        const markdown = "# Title\n\nThe **schedule** runs nightly.\n\nPlain words here.\n"
        const shown = "Title The schedule runs nightly. Plain words here."
        const hit = locateQuote(markdown, "Plain words here.", {
            before: "TitleTheschedulerunsnightly.",
            rendered: shown,
        })
        expect(hit).toMatchObject({startLine: 5, endLine: 5})
    })

    it("returns null for an excerpt the source does not hold", () => {
        expect(locateQuote(source, "**build**", {before: "", rendered: "build"})).toBeNull()
    })
})

describe("relocateQuote", () => {
    it("follows the occurrence nearest the quote's old line", () => {
        const next = "header\nretry: 3\nx\ny\nz\nretry: 3\n"
        expect(relocateQuote(next, "retry: 3", 5)).toMatchObject({startLine: 6})
        expect(relocateQuote(next, "retry: 3", 1)).toMatchObject({startLine: 2})
    })

    it("still finds an excerpt taken from pretty-printed JSON in the raw file", () => {
        expect(relocateQuote('{"a":1,\n"b":{"c":2}}', '"c": 2', 2)).toMatchObject({startLine: 2})
    })

    it("returns null once the excerpt is gone", () => {
        expect(relocateQuote("nothing here", "retry: 3", 2)).toBeNull()
    })
})

describe("refreshFileQuote", () => {
    it("moves a located quote's range with its excerpt", () => {
        const quote = fileQuote({text: "retry: 3", stale: false})
        const patch = refreshFileQuote(quote, "a\nb\nretry: 3\n")
        expect(patch).toMatchObject({stale: false, source: {startLine: 3, endLine: 3}})
    })

    it("flags a located quote stale when its excerpt is gone, and clears it on return", () => {
        const quote = fileQuote({text: "retry: 3"})
        expect(refreshFileQuote(quote, "retry: 4")).toEqual({stale: true})
        const back = refreshFileQuote({...quote, stale: true}, "retry: 3")
        expect(back).toMatchObject({stale: false, source: {startLine: 1}})
    })

    it("never flags a quote that was never located", () => {
        const quote = fileQuote({
            source: {
                kind: "file",
                path: "README.md",
                displayPath: "README.md",
                fileName: "README.md",
            },
        })
        expect(refreshFileQuote(quote, "something else entirely")).toBeNull()
    })

    it("changes nothing when the range still holds", () => {
        const quote = fileQuote({
            text: "b",
            source: {...fileQuote().source, startLine: 2, endLine: 2} as Quote["source"],
        })
        expect(refreshFileQuote(quote, "a\nb\nc")).toBeNull()
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
        expect(out).toContain("> **`agent-files/docs/07-schedule.mdx`** (L34–L36)  ")
        expect(out).toContain("> A schedule runs one pinned variant and revision.")
        expect(out).toContain("This contradicts the section above.")
        expect(out.endsWith("Fix these three.")).toBe(true)
    })

    it("labels a message quote by its turn", () => {
        const out = quotesToMarkdown([
            fileQuote({
                source: {kind: "message", messageId: "m1"},
                note: "",
            }),
        ])
        expect(out).toContain("> **Agent reply**  ")
    })

    it("stacks several quotes above one message", () => {
        const out = quotesToMarkdown([fileQuote(), fileQuote({id: "q2", note: "And this."})], "go")
        expect(out.match(/> \*\*`agent-files\/docs\/07-schedule\.mdx`\*\*/g)).toHaveLength(2)
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

    it("keeps code, indentation and blank lines inside the blockquote", () => {
        const text = "```yaml\nsteps:\n  - run: build\n\n  - run: test\n```"
        const out = quotesToMarkdown([fileQuote({text, note: ""})])
        expect(out).toContain("> ```yaml\n> steps:\n>   - run: build\n>\n>   - run: test\n> ```")
        // Every excerpt line is quoted: nothing escapes into the message body.
        const [, ...excerpt] = out.split("\n")
        expect(excerpt.every((line) => line.startsWith(">"))).toBe(true)
    })

    it("closes a code fence the selection cut open", () => {
        const out = quotesToMarkdown([fileQuote({text: "```ts\nconst a = 1", note: ""})], "Why?")
        expect(out).toContain("> ```ts\n> const a = 1\n> ```")
        expect(out.endsWith("\n\nWhy?")).toBe(true)
    })

    it("leaves a balanced fence alone and nests a quoted `>` line", () => {
        const out = quotesToMarkdown([fileQuote({text: "> an older reply\nnew line", note: ""})])
        expect(out).toContain("> > an older reply\n> new line")
        const fenced = quotesToMarkdown([fileQuote({text: "~~~\nx\n~~~", note: ""})])
        expect(fenced.match(/~~~/g)).toHaveLength(2)
    })
})
