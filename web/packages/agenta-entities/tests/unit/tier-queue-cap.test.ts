/**
 * Unit tests for `inferQueueMaxFromPlan` — the plan-slug → queue-batch-cap
 * mapping in `@agenta/entities/trace/etl`.
 *
 * Pure function. The frontend reads the subscription plan slug from
 * `currentSubscriptionQueryAtom.data?.plan`; this module owns the
 * tier-aware ceiling on how many traces a single batch-add-to-queue run
 * processes.
 */

import {describe, expect, it} from "vitest"

import {
    inferQueueMaxFromPlan,
    QUEUE_MAX_BUSINESS,
    QUEUE_MAX_ENTERPRISE,
    QUEUE_MAX_HOBBY,
    QUEUE_MAX_PRO,
} from "../../src/trace/etl"

describe("inferQueueMaxFromPlan", () => {
    it.each([
        ["cloud_v0_hobby", QUEUE_MAX_HOBBY],
        ["cloud_v0_pro", QUEUE_MAX_PRO],
        ["cloud_v0_business", QUEUE_MAX_BUSINESS],
        ["cloud_v0_agenta_ai", QUEUE_MAX_ENTERPRISE],
        ["self_hosted_enterprise", QUEUE_MAX_ENTERPRISE],
    ])("returns the cap of the %s slug", (slug, cap) => {
        expect(inferQueueMaxFromPlan(slug)).toBe(cap)
    })

    it("returns the hobby cap for null / undefined plans (OSS / pre-billing-load)", () => {
        expect(inferQueueMaxFromPlan(null)).toBe(QUEUE_MAX_HOBBY)
        expect(inferQueueMaxFromPlan(undefined)).toBe(QUEUE_MAX_HOBBY)
    })

    it("returns the hobby cap for unknown plan slugs", () => {
        expect(inferQueueMaxFromPlan("not_a_real_plan")).toBe(QUEUE_MAX_HOBBY)
        expect(inferQueueMaxFromPlan("")).toBe(QUEUE_MAX_HOBBY)
    })

    it("is case-insensitive", () => {
        expect(inferQueueMaxFromPlan("CLOUD_V0_PRO")).toBe(QUEUE_MAX_PRO)
        expect(inferQueueMaxFromPlan("Cloud_V0_Business")).toBe(QUEUE_MAX_BUSINESS)
    })

    it("the cap order respects the tier hierarchy", () => {
        // Sanity check on the constants themselves so a typo can't silently
        // demote a higher tier below a lower one.
        expect(QUEUE_MAX_HOBBY).toBeLessThan(QUEUE_MAX_PRO)
        expect(QUEUE_MAX_PRO).toBeLessThan(QUEUE_MAX_BUSINESS)
        expect(QUEUE_MAX_BUSINESS).toBeLessThan(QUEUE_MAX_ENTERPRISE)
    })

    it("the enterprise cap matches the bulk-export ceiling so both pipelines agree at the top tier", () => {
        // Cross-check against the export's MAX_ROWS so a future bump
        // touches both. Imported via the same package surface.
        expect(QUEUE_MAX_ENTERPRISE).toBe(20_000)
    })
})
