import {describe, expect, it} from "vitest"

import {isFilterMenuNarrowed, type FilterMenuItem} from "../../src/data/filter-menu/types"

const row = (value: string, defaultValue: string, block?: "filter" | "sort"): FilterMenuItem => ({
    key: `row-${value}`,
    label: "Row",
    value,
    defaultValue,
    block,
    options: [],
    onChange: () => undefined,
})

describe("isFilterMenuNarrowed", () => {
    it("is false when every filter row is at its default", () => {
        expect(isFilterMenuNarrowed([row("all", "all")])).toBe(false)
    })

    it("is true when a filter row leaves its default", () => {
        expect(isFilterMenuNarrowed([row("paused", "all")])).toBe(true)
    })

    it("ignores a group or sort row, which does not narrow the list", () => {
        expect(isFilterMenuNarrowed([row("all", "all"), row("type", "none", "sort")])).toBe(false)
    })

    it("ignores a filter row with no default", () => {
        const item = {...row("paused", "all"), defaultValue: undefined}
        expect(isFilterMenuNarrowed([item])).toBe(false)
    })

    it("counts a switch away from its default", () => {
        const toggle: FilterMenuItem = {
            kind: "toggle",
            key: "archived",
            label: "Only archived",
            checked: true,
            onChange: () => undefined,
        }
        expect(isFilterMenuNarrowed([toggle])).toBe(true)
        expect(isFilterMenuNarrowed([{...toggle, checked: false}])).toBe(false)
    })

    it("compares multi-select values regardless of order", () => {
        const multi = {...row("a", "a"), value: ["b", "a"], defaultValue: ["a", "b"], multi: true}
        expect(isFilterMenuNarrowed([multi as FilterMenuItem])).toBe(false)
    })
})
