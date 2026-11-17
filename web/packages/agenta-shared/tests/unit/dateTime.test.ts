import {afterAll, beforeAll, describe, expect, it} from "vitest"

import {formatDay, formatLocalDateTime} from "../../src/utils/dateTime"

const originalTz = process.env.TZ

beforeAll(() => {
    // UTC-5 in November, so a UTC clock and the local clock differ.
    process.env.TZ = "America/New_York"
})

afterAll(() => {
    process.env.TZ = originalTz
})

describe("formatLocalDateTime", () => {
    it("shows an ISO timestamp with Z in local time", () => {
        expect(formatLocalDateTime("2026-11-17T15:04:05.123Z")).toBe("17 Nov 2026, 10:04:05")
    })

    it("reads a timestamp with no zone designator as UTC, then shows it in local time", () => {
        expect(formatLocalDateTime("2026-11-17T15:04:05.123456")).toBe("17 Nov 2026, 10:04:05")
    })

    it("returns an empty string for a missing or invalid value", () => {
        expect(formatLocalDateTime(null)).toBe("")
        expect(formatLocalDateTime("not a date")).toBe("")
    })
})

describe("formatDay", () => {
    it("still formats in UTC for its callers", () => {
        expect(formatDay({date: "2026-11-17T02:00:00Z", outputFormat: "DD MMM YYYY HH:mm"})).toBe(
            "17 Nov 2026 02:00",
        )
    })
})
