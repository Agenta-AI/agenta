/**
 * Unit tests for the friendly schedule builder <-> cron bridge.
 *
 * builderToCron is always deterministic; cronToBuilder only reflects back the
 * cron subset the builder can draw (and reports `representable: false`
 * otherwise). These tests pin the generation, the representability boundary,
 * round-trips, the multi-time grid guard, and the human-readable summary.
 */

import {describe, expect, it} from "vitest"

import {
    builderToCron,
    cronToBuilder,
    defaultBuilderState,
    describeCadence,
    formatNextRun,
    suggestScheduleName,
    summarizeSchedule,
    timesFormCleanGrid,
    type ScheduleBuilderState,
} from "../../src/gatewayTrigger/core/scheduleBuilder"

function state(overrides: Partial<ScheduleBuilderState>): ScheduleBuilderState {
    return {...defaultBuilderState(overrides.cadence ?? "daily"), ...overrides}
}

describe("builderToCron", () => {
    it("generates hourly expressions", () => {
        expect(
            builderToCron(
                state({cadence: "hourly", everyNHours: 1, times: [{hour: 0, minute: 0}]}),
            ),
        ).toBe("0 * * * *")
        expect(
            builderToCron(
                state({cadence: "hourly", everyNHours: 3, times: [{hour: 0, minute: 15}]}),
            ),
        ).toBe("15 */3 * * *")
    })

    it("generates daily expressions with multiple times", () => {
        expect(builderToCron(state({cadence: "daily", times: [{hour: 9, minute: 0}]}))).toBe(
            "0 9 * * *",
        )
        expect(
            builderToCron(
                state({
                    cadence: "daily",
                    times: [
                        {hour: 21, minute: 0},
                        {hour: 9, minute: 0},
                    ],
                }),
            ),
        ).toBe("0 9,21 * * *")
    })

    it("generates weekly expressions", () => {
        expect(
            builderToCron(
                state({
                    cadence: "weekly",
                    weekdays: [5, 1, 3],
                    times: [
                        {hour: 9, minute: 0},
                        {hour: 21, minute: 0},
                    ],
                }),
            ),
        ).toBe("0 9,21 * * 1,3,5")
    })

    it("generates monthly expressions", () => {
        expect(
            builderToCron(
                state({cadence: "monthly", daysOfMonth: [15, 1], times: [{hour: 0, minute: 0}]}),
            ),
        ).toBe("0 0 1,15 * *")
    })

    it("passes a custom expression through untouched", () => {
        expect(builderToCron(state({cadence: "custom", cron: "*/15 9-17 * * 1-5"}))).toBe(
            "*/15 9-17 * * 1-5",
        )
    })
})

describe("cronToBuilder", () => {
    it("reflects representable expressions back into builder state", () => {
        const daily = cronToBuilder("0 9,21 * * *")
        expect(daily.representable).toBe(true)
        expect(daily.state.cadence).toBe("daily")
        expect(daily.state.times).toEqual([
            {hour: 9, minute: 0},
            {hour: 21, minute: 0},
        ])

        const weekly = cronToBuilder("0 9 * * 1,3,5")
        expect(weekly.representable).toBe(true)
        expect(weekly.state.cadence).toBe("weekly")
        expect(weekly.state.weekdays).toEqual([1, 3, 5])

        const hourly = cronToBuilder("0 */3 * * *")
        expect(hourly.representable).toBe(true)
        expect(hourly.state.cadence).toBe("hourly")
        expect(hourly.state.everyNHours).toBe(3)

        const monthly = cronToBuilder("0 0 1,15 * *")
        expect(monthly.representable).toBe(true)
        expect(monthly.state.cadence).toBe("monthly")
        expect(monthly.state.daysOfMonth).toEqual([1, 15])
    })

    it("falls back to custom for too-advanced but valid expressions", () => {
        for (const cron of ["*/15 9-17 * * 1-5", "0 9 1 * 1", "0 9 * 6 *", "0 9 L * *"]) {
            const result = cronToBuilder(cron)
            expect(result.representable).toBe(false)
            expect(result.state.cadence).toBe("custom")
            expect(result.state.cron).toBe(cron)
        }
    })

    it("falls back to custom for invalid expressions", () => {
        const result = cronToBuilder("0 25 * * *")
        expect(result.representable).toBe(false)
        expect(result.state.cadence).toBe("custom")
    })

    it("round-trips representable expressions", () => {
        for (const cron of [
            "0 * * * *",
            "15 */3 * * *",
            "0 9 * * *",
            "0 9,21 * * *",
            "0 9,21 * * 1,3,5",
            "0 0 1,15 * *",
        ]) {
            const {state: parsed, representable} = cronToBuilder(cron)
            expect(representable).toBe(true)
            expect(builderToCron(parsed)).toBe(cron)
        }
    })
})

describe("timesFormCleanGrid", () => {
    it("accepts times that form a full minute x hour grid", () => {
        expect(
            timesFormCleanGrid([
                {hour: 9, minute: 0},
                {hour: 21, minute: 0},
            ]),
        ).toBe(true)
        expect(
            timesFormCleanGrid([
                {hour: 9, minute: 0},
                {hour: 9, minute: 30},
                {hour: 21, minute: 0},
                {hour: 21, minute: 30},
            ]),
        ).toBe(true)
    })

    it("rejects times that would force cross-product runs", () => {
        // 09:00 + 21:30 alone implies 09:30 and 21:00 too — not a clean grid.
        expect(
            timesFormCleanGrid([
                {hour: 9, minute: 0},
                {hour: 21, minute: 30},
            ]),
        ).toBe(false)
    })
})

describe("describeCadence", () => {
    it("names each cadence without its run times", () => {
        expect(
            describeCadence(
                state({cadence: "hourly", everyNHours: 3, times: [{hour: 0, minute: 15}]}),
            ),
        ).toBe("Every 3h at :15")
        expect(describeCadence(state({cadence: "daily"}))).toBe("Daily")
        expect(describeCadence(state({cadence: "weekly", weekdays: [1, 3, 5]}))).toBe(
            "Mon, Wed and Fri",
        )
        expect(describeCadence(state({cadence: "weekly", weekdays: [1, 2, 3, 4, 5]}))).toBe(
            "Weekdays",
        )
        expect(describeCadence(state({cadence: "monthly", daysOfMonth: [1, 15]}))).toBe(
            "Monthly on the 1st and 15th",
        )
        expect(describeCadence(state({cadence: "custom", cron: "*/5 * * * *"}))).toBe("*/5 * * * *")
    })

    // A monthly schedule can select all 31 days; spelling each one out grew the collapsed row
    // until it truncated mid-word, so long lists keep the first few and count the rest.
    it("caps a long list instead of growing without bound", () => {
        expect(
            describeCadence(state({cadence: "monthly", daysOfMonth: [1, 11, 13, 17, 18, 19, 31]})),
        ).toBe("Monthly on the 1st, 11th, 13th +4")
        expect(describeCadence(state({cadence: "weekly", weekdays: [1, 2, 3, 4, 6]}))).toBe(
            "Mon, Tue, Wed +2",
        )
    })

    it("keeps the collapse shortcuts ahead of the cap", () => {
        expect(describeCadence(state({cadence: "weekly", weekdays: [0, 1, 2, 3, 4, 5, 6]}))).toBe(
            "Every day",
        )
        expect(describeCadence(state({cadence: "weekly", weekdays: [1, 2, 3, 4, 5]}))).toBe(
            "Weekdays",
        )
    })
})

describe("summarizeSchedule", () => {
    it("appends the run times and the UTC marker", () => {
        expect(
            summarizeSchedule(
                state({
                    cadence: "weekly",
                    weekdays: [1, 2, 3, 4, 5],
                    times: [{hour: 9, minute: 0}],
                }),
            ),
        ).toBe("Weekdays at 09:00 UTC")
        expect(
            summarizeSchedule(
                state({
                    cadence: "daily",
                    times: [
                        {hour: 9, minute: 0},
                        {hour: 21, minute: 0},
                    ],
                }),
            ),
        ).toBe("Daily at 09:00 and 21:00 UTC")
    })

    it("does not repeat a cadence that already carries its time", () => {
        expect(
            summarizeSchedule(
                state({cadence: "hourly", everyNHours: 6, times: [{hour: 0, minute: 30}]}),
            ),
        ).toBe("Every 6h at :30 UTC")
        expect(summarizeSchedule(state({cadence: "custom", cron: "0 9 * * 1-5"}))).toBe(
            "0 9 * * 1-5",
        )
    })
})

describe("formatNextRun", () => {
    // Fixed anchor so the relative phrase is deterministic: Mon 2026-08-10, 08:00 UTC.
    const from = new Date("2026-08-10T08:00:00.000Z")

    it("names the next fire time in UTC with a relative gap", () => {
        expect(formatNextRun("0 9 * * *", undefined, from)).toBe(
            "Next run Mon 10 Aug, 09:00 UTC · in 1 hour",
        )
        expect(formatNextRun("0 9 * * 3", undefined, from)).toBe(
            "Next run Wed 12 Aug, 09:00 UTC · in 2 days",
        )
    })

    it("adds the daily run count for an hourly cadence", () => {
        const hourly = state({cadence: "hourly", everyNHours: 6, times: [{hour: 0, minute: 0}]})
        expect(formatNextRun("0 */6 * * *", hourly, from)).toBe(
            "Next run Mon 10 Aug, 12:00 UTC · in 4 hours · 4 runs a day",
        )
    })

    it("returns empty when the expression has no computable next run", () => {
        expect(formatNextRun("not a cron", undefined, from)).toBe("")
    })
})

describe("suggestScheduleName", () => {
    it("combines the cadence, the time, and the agent", () => {
        expect(
            suggestScheduleName(
                state({
                    cadence: "weekly",
                    weekdays: [1, 2, 3, 4, 5],
                    times: [{hour: 9, minute: 0}],
                }),
                "daily-update",
            ),
        ).toBe("Weekdays 09:00 — daily-update")
    })

    it("skips the time when the cadence already carries one, and the dash with no agent", () => {
        expect(
            suggestScheduleName(
                state({cadence: "hourly", everyNHours: 2, times: [{hour: 0, minute: 0}]}),
                "daily-update",
            ),
        ).toBe("Every 2h at :00 — daily-update")
        expect(suggestScheduleName(state({cadence: "daily", times: [{hour: 9, minute: 0}]}))).toBe(
            "Daily 09:00",
        )
    })
})
