import {describe, expect, it, vi} from "vitest"

import {openLinkedDeliverySession} from "../../src/gatewayTrigger/drawers/linkedSessionAction"

describe("openLinkedDeliverySession", () => {
    it("closes the delivery drawer before navigating", () => {
        const order: string[] = []
        const closeDrawer = vi.fn(() => order.push("close"))
        const navigate = vi.fn(() => order.push("navigate"))

        openLinkedDeliverySession({
            closeDrawer,
            navigate,
            sessionId: "session-1",
            applicationId: "application-1",
        })

        expect(order).toEqual(["close", "navigate"])
        expect(navigate).toHaveBeenCalledWith("session-1", "application-1")
    })
})
