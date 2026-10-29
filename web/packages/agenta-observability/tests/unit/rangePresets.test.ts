import {dayjs} from "@agenta/shared/utils/dateTime"
import {describe, expect, it} from "vitest"

import {ALL_TIME_START, resolveRangePreset, toRangeInstant} from "../../src/core/presets"

/**
 * `sorted` was emitted as UTC with the designator stripped (`toISOString().split(".")[0]`), and
 * `fetchDashboardAnalytics` reparses it with `dayjs()` — which reads a bare timestamp as LOCAL
 * time. Every preset window was therefore skewed by the viewer's offset, and "all time" resolved
 * to an empty string that the same fetch throws on.
 */

describe("resolveRangePreset", () => {
    it("emits an unambiguous UTC instant", () => {
        const {sorted} = resolveRangePreset("24 hours")

        expect(sorted).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/)
    })

    it("puts the window exactly one preset behind now, whatever the viewer's offset", () => {
        const {sorted} = resolveRangePreset("24 hours")

        // Reparsed the way the query layer reparses it. Without the designator this drifts by the
        // local offset (three hours in UTC+3) and the dashboard silently queries the wrong window.
        const drift = Math.abs(dayjs().diff(dayjs(sorted), "minute") - 24 * 60)
        expect(drift).toBeLessThan(2)
    })

    it("gives 'all time' a real start rather than an empty string", () => {
        const {sorted} = resolveRangePreset("all time")

        expect(sorted).toBe(ALL_TIME_START)
        expect(dayjs(sorted).isValid()).toBe(true)
        expect(dayjs(sorted).valueOf()).toBe(0)
    })

    it("keeps the label and the standard shape", () => {
        expect(resolveRangePreset("7 days")).toMatchObject({
            type: "standard",
            label: "7 days",
            customRange: {},
        })
    })
})

describe("toRangeInstant", () => {
    it("normalises any input zone to UTC", () => {
        const instant = "2026-03-10T12:00:00Z"

        expect(toRangeInstant(dayjs(instant))).toBe("2026-03-10T12:00:00Z")
    })
})
