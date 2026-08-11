import {createElement} from "react"
import {renderToStaticMarkup} from "react-dom/server"

import {describe, expect, it, vi} from "vitest"

import {TriggerDeliveriesDrawerContent} from "../../src/gatewayTrigger/drawers/TriggerDeliveriesDrawerContent"

describe("TriggerDeliveriesDrawerContent", () => {
    it("does not mount owner history in exact-delivery mode", () => {
        const ownerHistoryQuery = vi.fn(() => createElement("div", null, "owner history"))
        const exactDelivery = vi.fn(() => createElement("div", null, "exact delivery"))

        const markup = renderToStaticMarkup(
            createElement(TriggerDeliveriesDrawerContent, {
                state: {mode: "exact-delivery", deliveryId: "delivery-1"},
                ownerHistory: createElement(ownerHistoryQuery),
                exactDelivery: createElement(exactDelivery),
            }),
        )

        expect(markup).toContain("exact delivery")
        expect(exactDelivery).toHaveBeenCalledTimes(1)
        expect(ownerHistoryQuery).not.toHaveBeenCalled()
    })
})
