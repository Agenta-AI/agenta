import {
    deliveryOutcome,
    deriveRunList,
    DEFAULT_RUN_LIST_VIEW,
    runDotClass,
    runGroups,
    runOutcomeLabel,
} from "@agenta/automation-ui"
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

const started = (outcome?: string, code = "202", message = "dispatched"): TriggerDelivery =>
    ({
        id: `${code}-${outcome}`,
        status: {message, code},
        data: outcome ? {outcome} : {},
    }) as unknown as TriggerDelivery

describe("a started run reads its settled outcome", () => {
    it("shows a completed and a failed run as done, not as running", () => {
        expect(deliveryOutcome(started("completed"))).toBe("ok")
        expect(runOutcomeLabel(started("completed"))).toBe("Succeeded")
        expect(deliveryOutcome(started("failed"))).toBe("bad")
        expect(runOutcomeLabel(started("failed"))).toBe("Failed")
    })

    it("gives cancelled and waiting runs their own label and dot", () => {
        expect(deliveryOutcome(started("cancelled"))).toBe("cancelled")
        expect(runOutcomeLabel(started("cancelled"))).toBe("Cancelled")
        expect(deliveryOutcome(started("waiting"))).toBe("waiting")
        expect(runOutcomeLabel(started("waiting"))).toBe("Waiting for a person")

        const dots = ["cancelled", "waiting", undefined].map((value) => runDotClass(started(value)))
        expect(new Set(dots).size).toBe(3)
    })

    it("keeps a run with no outcome as running", () => {
        expect(deliveryOutcome(started())).toBe("pending")
        expect(runOutcomeLabel(started())).toBe("Running")
    })

    it("keeps reading the status of a row that is no longer 202", () => {
        expect(deliveryOutcome(started("failed", "409", "failed"))).toBe("bad")
        expect(deliveryOutcome(started("failed", "200", "success"))).toBe("ok")
        expect(deliveryOutcome(started("completed", "500", "failed"))).toBe("bad")
    })

    it("filters and groups by the new outcomes", () => {
        const runs = [started("cancelled"), started("waiting"), started()]

        expect(
            deriveRunList(runs, {...DEFAULT_RUN_LIST_VIEW, status: "cancelled"}).map(
                (run) => run.id,
            ),
        ).toEqual(["202-cancelled"])
        expect(
            deriveRunList(runs, {...DEFAULT_RUN_LIST_VIEW, status: "waiting"}).map((run) => run.id),
        ).toEqual(["202-waiting"])
        expect(runGroups(runs, "status").map((group) => group.label)).toEqual([
            "Cancelled",
            "Waiting for a person",
            "Running",
        ])
    })
})
