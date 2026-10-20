import {describe, expect, it} from "vitest"

import {nextCatalogTarget} from "../../src/gatewayTool/hooks/useToolCatalogIntegrations"

describe("tool catalog paging", () => {
    it("asks for pages beyond a warm cache when the sentinel is reached again", () => {
        expect(nextCatalogTarget(3, 12)).toBe(14)
    })

    it("grows the target by the prefetch window on a cold catalog", () => {
        expect(nextCatalogTarget(3, 1)).toBe(5)
    })
})
