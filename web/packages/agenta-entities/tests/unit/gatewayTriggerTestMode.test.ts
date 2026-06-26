/**
 * Unit tests for the trigger-subscription test-mode schema fields.
 *
 * `is_test` is the FE mirror of the backend flag: it lives on the subscription
 * flags (drives the capture-and-skip lifecycle) and is echoed onto a delivery's
 * data so the playground can tell a test capture from a real run. These pin the
 * defaults and round-trip, since the schemas are an independent drift check
 * against the Fern types.
 */

import {describe, expect, it} from "vitest"

import {
    triggerDeliveryDataSchema,
    triggerSubscriptionFlagsSchema,
} from "../../src/gatewayTrigger/core/types"

describe("triggerSubscriptionFlagsSchema is_test", () => {
    it("defaults is_test to false when absent", () => {
        const parsed = triggerSubscriptionFlagsSchema.parse({})
        expect(parsed.is_test).toBe(false)
        expect(parsed.is_active).toBe(true)
        expect(parsed.is_valid).toBe(true)
    })

    it("round-trips an explicit is_test=true", () => {
        const parsed = triggerSubscriptionFlagsSchema.parse({is_test: true})
        expect(parsed.is_test).toBe(true)
    })
})

describe("triggerDeliveryDataSchema is_test", () => {
    it("accepts a delivery marked is_test", () => {
        const parsed = triggerDeliveryDataSchema.parse({
            event_key: "github.issue.opened",
            inputs: {event: {attributes: {issue: {number: 7}}}},
            is_test: true,
        })
        expect(parsed.is_test).toBe(true)
    })

    it("leaves is_test undefined for a normal delivery", () => {
        const parsed = triggerDeliveryDataSchema.parse({event_key: "x"})
        expect(parsed.is_test ?? null).toBeNull()
    })
})
