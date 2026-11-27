/**
 * Shape detection runs in every table cell, so it must stay linear on large values. These tests
 * pin that the markdown checks and the JSON text parse give the same answers as the patterns and
 * the parse they replaced, and that the slow inputs stay fast.
 */
import JSON5 from "json5"
import {describe, expect, it} from "vitest"

import {parseStructuredJson} from "../../src/utils/jsonParsing"
import {detectValueShape, hasMarkdownSyntax} from "../../src/utils/valueShape"

/** The checks `hasMarkdownSyntax` ran before the list and link checks were made linear. */
const LEGACY_PATTERNS = [
    /^#{1,6}\s+\S/m,
    /^\s*(?:[-*+]|\d+[.)])\s+\S/m,
    /^>\s?\S/m,
    /^```/m,
    /^\|.+\|\s*$/m,
    /\*\*[^*\n]+\*\*/,
    /\[[^\]\n]+\]\([^)\s]+\)/,
]

/** A deterministic text of the characters the link and list checks care about. */
const sample = (seed: number, length: number) => {
    const alphabet = ["[", "]", "(", ")", "\n", " ", "\t", "a", "-", "1", ".", "\r", " "]
    let state = seed
    let text = ""
    for (let index = 0; index < length; index++) {
        state = (state * 1103515245 + 12345) % 2147483648
        text += alphabet[state % alphabet.length]
    }
    return text
}

describe("markdown detection", () => {
    it("gives the same answer as the patterns it replaced", () => {
        const cases = [
            "[a](b)",
            "[](b)",
            "[a]()",
            "[a] (b)",
            "[a](b c)",
            "x[a[b](c)",
            "[x[](c)",
            "[a\n](b)",
            "[a](b\n)",
            "](x) [a](b)",
            "[a](](c)",
            "- item",
            " - item",
            "\n\n  1. item",
            "-\n  next",
        ]
        for (let seed = 1; seed <= 3000; seed++) cases.push(sample(seed, 24))
        for (const text of cases) {
            const legacy = LEGACY_PATTERNS.some((pattern) => pattern.test(text))
            expect([text, hasMarkdownSyntax(text)]).toEqual([text, legacy])
        }
    })

    it("stays fast on long runs of brackets and blank lines", () => {
        const inputs = [
            "x" + "[".repeat(200_000),
            "x" + "[a]".repeat(70_000),
            "[a]" + "](".repeat(100_000),
            "\n".repeat(200_000) + "x",
            "-" + " \n".repeat(100_000),
        ]
        const start = performance.now()
        for (const text of inputs) detectValueShape(text)
        expect(performance.now() - start).toBeLessThan(500)
    })
})

describe("JSON text", () => {
    it("skips the JSON5 parse only where JSON5 gives no structured value", () => {
        const cases = [
            "{a: 1}",
            "{a: 1,}",
            "[1, 2,]",
            "{a: 1} // note",
            "{a: 1} /* note */",
            "{a: 1}\n// note",
            "{'a': 'b'}",
            '"{\\"a\\": 1}"',
            '{"a": "cut',
            '{"url": "https://example.com/a',
            "[1, 2",
            "{a: 1} x",
        ]
        for (const text of cases) {
            let viaJson5: unknown = null
            try {
                const parsed = JSON5.parse(text)
                viaJson5 = parsed && typeof parsed === "object" ? parsed : null
            } catch {
                viaJson5 = null
            }
            if (viaJson5 !== null) expect(parseStructuredJson(text)).toEqual(viaJson5)
            if (!/[}\]"'/]$/.test(text) && !text.split("\n").pop()!.includes("//")) {
                expect(parseStructuredJson(text)).toBeNull()
            }
        }
    })

    it("reads a cut-off output of 1 MB as long text quickly", () => {
        const cut = JSON.stringify({rows: Array.from({length: 40_000}, (_, i) => ({i}))}).slice(
            0,
            -3,
        )
        const start = performance.now()
        expect(detectValueShape(cut).shape).toBe("text-long")
        expect(performance.now() - start).toBeLessThan(500)
    })
})
