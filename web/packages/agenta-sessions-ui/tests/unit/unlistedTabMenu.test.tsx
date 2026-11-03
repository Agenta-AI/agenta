/**
 * #6379: an unlisted chip — a session opened before its row lands — used to carry no context
 * menu at all, so a right-click on it did nothing and the menu read as broken. It has no row
 * view-model for the host's verbs, but the tab verbs need only the strip.
 */
import {describe, expect, it} from "vitest"

import {
    CLOSE,
    CLOSE_OTHERS,
    CLOSE_RIGHT,
    unlistedTabCloseIds,
    unlistedTabMenu,
} from "../../src/railTabMenu"

const tabs = [
    {id: "pinned", pinned: true},
    {id: "a", pinned: false},
    {id: "fresh", pinned: false},
    {id: "b", pinned: false},
]

describe("unlistedTabMenu", () => {
    it("offers the three tab verbs and nothing above them", () => {
        const keys = unlistedTabMenu(tabs, "fresh").map((entry) =>
            "key" in entry ? entry.key : entry.type,
        )
        expect(keys).toEqual([CLOSE, CLOSE_OTHERS, CLOSE_RIGHT])
    })

    it("disables what cannot apply on a lone tab", () => {
        const entries = unlistedTabMenu([{id: "fresh", pinned: false}], "fresh")
        expect(entries.map((entry) => "key" in entry && entry.disabled)).toEqual([true, true, true])
    })
})

describe("unlistedTabCloseIds", () => {
    it("names the chip itself for Close", () => {
        expect(unlistedTabCloseIds(CLOSE, tabs, "fresh")).toEqual(["fresh"])
    })

    it("spares pinned tabs from Close other tabs", () => {
        expect(unlistedTabCloseIds(CLOSE_OTHERS, tabs, "fresh")).toEqual(["a", "b"])
    })

    it("takes only what sits to the right", () => {
        expect(unlistedTabCloseIds(CLOSE_RIGHT, tabs, "fresh")).toEqual(["b"])
    })

    it("answers null for a key it does not own", () => {
        expect(unlistedTabCloseIds("archive", tabs, "fresh")).toBeNull()
    })
})
