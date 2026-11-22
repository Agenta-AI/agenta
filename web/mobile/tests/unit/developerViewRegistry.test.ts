import {describe, expect, it} from "vitest"

import {DEVELOPER_VIEWS} from "@/features/developer/developerViews"

describe("developer view registry", () => {
    it("gives every view with a nav link a link-ready first route", () => {
        for (const view of DEVELOPER_VIEWS) {
            if (!view.nav) continue
            expect(view.routes?.[0]).toBeDefined()
            expect(view.routes![0]).not.toContain("[")
            expect(view.nav.section).toBe("developer")
        }
    })

    it("gives a feature gate with no routes no nav link", () => {
        for (const view of DEVELOPER_VIEWS.filter((entry) => !entry.routes))
            expect(view.nav).toBeUndefined()
    })
})
