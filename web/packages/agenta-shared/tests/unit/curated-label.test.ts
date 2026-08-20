/**
 * Unit tests for `splitCuratedLabel`.
 *
 * The picker draws a curated model's trailing aside — "(default)", "(cheapest)", "(1M context)" —
 * quieter than the name beside it. The vocabulary lives in the harness catalogs, not here, so the
 * split is positional: what these pin down is which parentheses count as an aside and which belong
 * to the name.
 */
import {splitCuratedLabel} from "@agenta/shared/utils"
import {describe, expect, it} from "vitest"

describe("splitCuratedLabel", () => {
    it("splits the catalog's own asides off the model name", () => {
        expect(splitCuratedLabel("Sol (default)")).toEqual({name: "Sol", hint: "(default)"})
        expect(splitCuratedLabel("Luna (cheapest)")).toEqual({name: "Luna", hint: "(cheapest)"})
    })

    it("takes any trailing aside, not a hardcoded pair", () => {
        // Claude's catalog marks a context window the same way; nothing here enumerates the words.
        expect(splitCuratedLabel("Opus (1M context)")).toEqual({name: "Opus", hint: "(1M context)"})
    })

    it("leaves a label with no aside whole", () => {
        expect(splitCuratedLabel("GPT-5.5")).toEqual({name: "GPT-5.5"})
        expect(splitCuratedLabel("Claude Haiku 4.5")).toEqual({name: "Claude Haiku 4.5"})
    })

    it("keeps parentheses that are not trailing as part of the name", () => {
        expect(splitCuratedLabel("GPT (preview) turbo")).toEqual({name: "GPT (preview) turbo"})
    })

    it("keeps a label that is nothing but a parenthetical, having no name to strip to", () => {
        expect(splitCuratedLabel("(default)")).toEqual({name: "(default)"})
    })
})
