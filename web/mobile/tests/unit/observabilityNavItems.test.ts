/**
 * The Observability rail row: it is there in developer mode, like the old app, and the traces
 * screen does not prefetch from the rail.
 */
import {describe, expect, it} from "vitest"

import {observabilityNavItems} from "@/features/nav/observabilityNavItems"

describe("the Observability rail row", () => {
    it("Developer mode shows Observability, linked to the project traces", () => {
        const items = observabilityNavItems("/w/ws-1/p/proj-1", true)
        expect(items.map(({key, title, link, prefetch}) => ({key, title, link, prefetch}))).toEqual(
            [
                {
                    key: "mobile-observability",
                    title: "Observability",
                    link: "/w/ws-1/p/proj-1/observability",
                    prefetch: false,
                },
            ],
        )
    })

    it("The simplified navigation has no Observability row", () => {
        expect(observabilityNavItems("/w/ws-1/p/proj-1", false)).toEqual([])
    })
})
