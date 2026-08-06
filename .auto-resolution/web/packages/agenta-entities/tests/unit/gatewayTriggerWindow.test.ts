/**
 * Unit tests for the trigger-schedule active-window helpers.
 *
 * start_time/end_time are stored as UTC ISO strings but edited through an
 * antd DatePicker that operates in the browser's local zone. The two helpers
 * map a UTC instant onto the same local clock face and back, so the user picks
 * the UTC wall-clock directly. These tests pin that the round-trip preserves
 * the UTC wall-clock under a NON-UTC runner zone — a naive `new Date(iso)`
 * implementation would shift by the zone offset and fail here.
 */

import {afterAll, beforeAll, describe, expect, it} from "vitest"

const ORIGINAL_TZ = process.env.TZ

// Set a non-UTC zone before importing anything that touches dayjs, so a
// zone-offset bug is observable rather than hidden by a UTC CI box.
beforeAll(() => {
    process.env.TZ = "America/New_York"
})
afterAll(() => {
    process.env.TZ = ORIGINAL_TZ
})

const {utcIsoToLocalFace, localFaceToUtcIso} = await import("../../src/gatewayTrigger/core/window")

describe("utcIsoToLocalFace", () => {
    it("returns null for null/undefined/empty", () => {
        expect(utcIsoToLocalFace(null)).toBeNull()
        expect(utcIsoToLocalFace(undefined)).toBeNull()
        expect(utcIsoToLocalFace("")).toBeNull()
    })

    it("maps the UTC wall-clock onto the local clock face", () => {
        const face = utcIsoToLocalFace("2026-06-22T10:05:00.000Z")
        // The picker should DISPLAY 10:05 regardless of local zone offset.
        expect(face?.hour()).toBe(10)
        expect(face?.minute()).toBe(5)
        expect(face?.year()).toBe(2026)
        expect(face?.month()).toBe(5) // June (0-indexed)
        expect(face?.date()).toBe(22)
    })
})

describe("localFaceToUtcIso", () => {
    it("returns null for null/undefined", () => {
        expect(localFaceToUtcIso(null)).toBeNull()
        expect(localFaceToUtcIso(undefined)).toBeNull()
    })

    it("reads the local clock face back as the UTC wall-clock, minute-floored", () => {
        const face = utcIsoToLocalFace("2026-06-22T10:05:42.999Z")
        expect(localFaceToUtcIso(face)).toBe("2026-06-22T10:05:00.000Z")
    })
})

describe("round-trip under a non-UTC zone", () => {
    it.each([
        "2026-01-15T00:00:00.000Z",
        "2026-06-22T10:05:00.000Z",
        "2026-12-31T23:59:00.000Z",
        "2026-03-08T07:30:00.000Z", // near a US DST transition
    ])("preserves the UTC wall-clock for %s", (iso) => {
        expect(localFaceToUtcIso(utcIsoToLocalFace(iso))).toBe(iso)
    })
})
