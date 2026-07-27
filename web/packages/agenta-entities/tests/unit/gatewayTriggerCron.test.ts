/**
 * Unit tests for the trigger-schedule cron helpers.
 *
 * Schedules use a 5-field UTC cron expression. The web has no cron dependency,
 * so `core/cron.ts` is a tiny local validator + describer + "next runs" preview
 * (the backend croniter remains the source of truth). These tests pin the
 * validation bounds, the human-readable description, and the next-run scan.
 */

import {describe, expect, it} from "vitest"

import {describeCron, nextCronRuns, validateCron} from "../../src/gatewayTrigger/core/cron"

describe("validateCron", () => {
    it("accepts a well-formed 5-field expression", () => {
        expect(validateCron("0 9 * * *")).toEqual({valid: true})
        expect(validateCron("*/15 * * * *")).toEqual({valid: true})
        expect(validateCron("0 0 1-15 1,6 1-5")).toEqual({valid: true})
    })

    it("rejects an empty expression", () => {
        expect(validateCron("   ")).toMatchObject({valid: false})
    })

    it("rejects the wrong number of fields", () => {
        const res = validateCron("0 9 * *")
        expect(res.valid).toBe(false)
        expect(res.error).toContain("5 fields")
    })

    it("rejects out-of-bounds field values", () => {
        expect(validateCron("99 * * * *").valid).toBe(false) // minute > 59
        expect(validateCron("0 24 * * *").valid).toBe(false) // hour > 23
        expect(validateCron("0 0 0 * *").valid).toBe(false) // day-of-month < 1
        expect(validateCron("0 0 * 13 *").valid).toBe(false) // month > 12
        expect(validateCron("0 0 * * 7").valid).toBe(false) // weekday > 6
    })

    it("rejects a bad step and a reversed range", () => {
        expect(validateCron("*/0 * * * *").valid).toBe(false)
        expect(validateCron("0 0 10-5 * *").valid).toBe(false)
    })
})

describe("describeCron", () => {
    it("describes the common shapes", () => {
        expect(describeCron("* * * * *")).toBe("Every minute (UTC)")
        expect(describeCron("*/5 * * * *")).toBe("Every 5 minutes (UTC)")
        expect(describeCron("0 * * * *")).toBe("Every hour (UTC)")
        expect(describeCron("30 9 * * *")).toBe("Every day at 09:30 UTC")
        expect(describeCron("0 9 * * 1")).toBe("Every Monday at 09:00 UTC")
    })

    it("echoes the raw expression for exotic shapes", () => {
        expect(describeCron("0 9 1,15 * *")).toBe("0 9 1,15 * * (UTC)")
    })

    it("echoes an invalid expression unchanged", () => {
        expect(describeCron("nonsense")).toBe("nonsense")
    })
})

describe("nextCronRuns", () => {
    it("returns the requested count of UTC fire times for a daily schedule", () => {
        const from = new Date("2026-06-21T08:00:00Z")
        const runs = nextCronRuns("0 9 * * *", 3, from)

        expect(runs).toHaveLength(3)
        expect(runs[0].toISOString()).toBe("2026-06-21T09:00:00.000Z")
        expect(runs[1].toISOString()).toBe("2026-06-22T09:00:00.000Z")
        expect(runs[2].toISOString()).toBe("2026-06-23T09:00:00.000Z")
    })

    it("steps every-N-minutes from the next whole minute", () => {
        const from = new Date("2026-06-21T08:00:30Z")
        const runs = nextCronRuns("*/15 * * * *", 2, from)

        expect(runs[0].toISOString()).toBe("2026-06-21T08:15:00.000Z")
        expect(runs[1].toISOString()).toBe("2026-06-21T08:30:00.000Z")
    })

    it("returns an empty list for an invalid expression", () => {
        expect(nextCronRuns("nope", 3)).toEqual([])
    })

    it("unions day-of-month and day-of-week when both are restricted", () => {
        // `0 0 1 * 1` = midnight on the 1st OR on any Monday (POSIX cron / the
        // backend croniter). 2026-06-22 is a Monday, so the next fires are the
        // following Monday, then the 1st, then the next Monday — NOT the rare
        // 1st-of-month-that-is-also-a-Monday (which would be 2027-02-01).
        const from = new Date("2026-06-22T08:00:00Z")
        const runs = nextCronRuns("0 0 1 * 1", 3, from)

        expect(runs.map((r) => r.toISOString())).toEqual([
            "2026-06-29T00:00:00.000Z", // Monday
            "2026-07-01T00:00:00.000Z", // 1st of the month
            "2026-07-06T00:00:00.000Z", // Monday
        ])
    })

    it("keeps plain AND semantics when only one day field is restricted", () => {
        const from = new Date("2026-06-22T08:00:00Z")
        // Only day-of-month restricted: every 1st of the month.
        expect(nextCronRuns("0 0 1 * *", 2, from).map((r) => r.toISOString())).toEqual([
            "2026-07-01T00:00:00.000Z",
            "2026-08-01T00:00:00.000Z",
        ])
        // Only day-of-week restricted: every Monday.
        expect(nextCronRuns("0 0 * * 1", 2, from).map((r) => r.toISOString())).toEqual([
            "2026-06-29T00:00:00.000Z",
            "2026-07-06T00:00:00.000Z",
        ])
    })
})
