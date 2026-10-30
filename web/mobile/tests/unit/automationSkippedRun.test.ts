import {deliveryOutcome, runDotClass, runOutcomeLabel} from "@agenta/automation-ui"
import type {TriggerDelivery} from "@agenta/entities/gatewayTrigger"
import {describe, expect, it} from "vitest"

const delivery = (message: string): TriggerDelivery =>
    ({
        id: "d1",
        status: {message, code: "422"},
        data: {error_details: {code: "agent_needs_setup"}},
    }) as unknown as TriggerDelivery

describe("a delivery skipped because the agent needs setup", () => {
    it("is its own outcome, neither ok nor bad", () => {
        expect(deliveryOutcome(delivery("skipped"))).toBe("skipped")
        expect(deliveryOutcome(delivery("success"))).toBe("ok")
        expect(deliveryOutcome(delivery("failed"))).toBe("bad")
        expect(deliveryOutcome(delivery("dispatched"))).toBe("pending")
    })

    it("says why instead of reading as a run in flight", () => {
        expect(runOutcomeLabel(delivery("skipped"))).toBe("Skipped: agent needs setup")
        expect(runOutcomeLabel(delivery("dispatched"))).toBe("Running")
        expect(runDotClass(delivery("skipped"))).not.toBe(runDotClass(delivery("dispatched")))
    })
})
