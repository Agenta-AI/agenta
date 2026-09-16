import {describe, expect, it} from "vitest"

import {columnWidths, visibleAtViewport} from "../../src/components/ui/data-table"

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

    it("does not shrink flexible columns past their floor when the table is far narrower", () => {
        // 400 - (280 + 56) leaves 64 for 450 of flexible width: under the floor, so the
        // declared widths stand and the table scrolls rather than squeezing every column.
        expect(columnWidths(MEMBERS, 56, 400)).toEqual([280, 290, 160])
    })

    it("lets flexible columns give way down to their floor before the table overflows", () => {
        // A 390px phone: Provider 200 pinned + 40 gutter, Name 200 flexible, 356 of room once
        // the page's gutters are paid. Name trims to the 116 left rather than pushing the
        // row's menu off the screen (#6206).
        const providers = [
            {key: "kind", width: 200, render: () => null},
            {key: "name", width: 200, render: () => null},
        ]
        expect(columnWidths(providers, 40, 356)).toEqual([200, 116])
        // Exactly at the floor still fits; one pixel under it falls back to declared widths.
        expect(columnWidths(providers, 40, 340)).toEqual([200, 100])
        expect(columnWidths(providers, 40, 339)).toEqual([200, 200])
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

describe("visibleAtViewport", () => {
    const columns = [
        {key: "kind", width: 200, render: () => null},
        {key: "name", width: 200, render: () => null},
        {key: "credential", width: 220, responsive: "md" as const, render: () => null},
        {key: "created_at", width: 170, responsive: "lg" as const, render: () => null},
    ]
    const keys = (matches: {sm: boolean; md: boolean; lg: boolean; xl: boolean}) =>
        visibleAtViewport(columns, matches).map((column) => column.key)

    it("drops a column below the viewport it belongs to", () => {
        expect(keys({sm: false, md: false, lg: false, xl: false})).toEqual(["kind", "name"])
        expect(keys({sm: true, md: true, lg: false, xl: false})).toEqual([
            "kind",
            "name",
            "credential",
        ])
        expect(keys({sm: true, md: true, lg: true, xl: false})).toEqual([
            "kind",
            "name",
            "credential",
            "created_at",
        ])
    })
})
