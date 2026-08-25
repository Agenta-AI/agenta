import {describe, expect, it} from "vitest"

import {columnWidths, tableMinWidth} from "../../src/components/ui/data-table"

/**
 * The numbers here are the desktop app's own, measured live on the Members table at the
 * 1800px viewport: Member 280 (pinned), Email 505, Added 279, gutter 56, container 1120.
 */
const MEMBERS = [
    {key: "member", width: 280, render: () => null},
    {key: "email", width: 290, render: () => null},
    {key: "created_at", width: 160, render: () => null},
]

describe("columnWidths", () => {
    it("pins the identity column and shares the surplus in the declared proportion", () => {
        expect(columnWidths(MEMBERS, 56, 1120)).toEqual([280, 505, 279])
    })

    it("falls back to declared widths before the container is measured", () => {
        expect(columnWidths(MEMBERS, 56, 0)).toEqual([280, 290, 160])
    })

    it("does not shrink flexible columns when the table is narrower than its columns", () => {
        expect(columnWidths(MEMBERS, 56, 400)).toEqual([280, 290, 160])
    })

    it("keeps the table at least as wide as its declared columns so overflow-x can scroll", () => {
        const widths = columnWidths(MEMBERS, 56, 400)
        expect(tableMinWidth(widths, 56)).toBe(280 + 290 + 160 + 56)
        expect(tableMinWidth(widths, 56)).toBeGreaterThan(400)
    })

    it("honours an explicit flexible:false on a later column", () => {
        const columns = [
            {key: "a", width: 100, flexible: true, render: () => null},
            {key: "b", width: 100, flexible: false, render: () => null},
        ]
        // `b` is pinned, so `a` alone absorbs 600 - 100 = 500.
        expect(columnWidths(columns, 0, 600)).toEqual([500, 100])
    })

    it("leaves a column with no declared width to the browser", () => {
        const columns = [
            {key: "a", width: 100, render: () => null},
            {key: "b", render: () => null},
        ]
        expect(columnWidths(columns, 0, 600)).toEqual([100, undefined])
    })
})
