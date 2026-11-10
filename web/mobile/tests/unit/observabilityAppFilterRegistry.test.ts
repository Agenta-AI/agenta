import {describe, expect, it} from "vitest"

import {DEVELOPER_VIEWS} from "@/features/developer/developerViews"

describe("observability-app-filter registry entry", () => {
    it("observability-app-filter is listed in preview with no nav link", () => {
        const view = DEVELOPER_VIEWS.find((entry) => entry.id === "observability-app-filter")

        expect(view).toBeDefined()
        expect(view?.stage).toBe("preview")
        expect(view?.routes).toBeUndefined()
        expect(view?.nav).toBeUndefined()
    })
})
