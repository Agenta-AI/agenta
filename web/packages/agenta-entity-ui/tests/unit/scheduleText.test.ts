/**
 * The schedule words come from the entityUi.scheduleText catalog. These tests pin the English
 * text byte for byte as it was before translation: it is shown in English and it is part of the
 * automation name saved to the API (`englishScheduleText`), so it must not drift.
 */

import {
    cronToBuilder,
    defaultBuilderState,
    describeCadence,
    describeCron,
    describeSchedule,
    formatNextRun,
    suggestScheduleName,
    summarizeSchedule,
    type ScheduleBuilderState,
    type ScheduleText,
} from "@agenta/entities/gatewayTrigger"
import {activeLanguageAtom} from "@agenta/i18n"
import {getDefaultStore} from "jotai"
import {afterEach, describe, expect, it} from "vitest"

import {englishScheduleText, scheduleTextNow} from "../../src/gatewayTrigger/scheduleText"

function state(overrides: Partial<ScheduleBuilderState>): ScheduleBuilderState {
    return {...defaultBuilderState(overrides.cadence ?? "daily"), ...overrides}
}

// In English the display words and the saved words are the same, so both builders must pass.
describe.each([
    ["englishScheduleText", englishScheduleText],
    ["scheduleTextNow in English", scheduleTextNow],
])("%s", (_name, build: () => ScheduleText) => {
    it("describes each cadence without its run times", () => {
        const text = build()
        expect(
            describeCadence(
                state({cadence: "hourly", everyNHours: 3, times: [{hour: 0, minute: 15}]}),
                text,
            ),
        ).toBe("Every 3h at :15")
        expect(describeCadence(state({cadence: "daily"}), text)).toBe("Daily")
        expect(describeCadence(state({cadence: "weekly", weekdays: [1, 3, 5]}), text)).toBe(
            "Mon, Wed and Fri",
        )
        expect(describeCadence(state({cadence: "weekly", weekdays: [1, 2, 3, 4, 5]}), text)).toBe(
            "Weekdays",
        )
        expect(
            describeCadence(state({cadence: "weekly", weekdays: [0, 1, 2, 3, 4, 5, 6]}), text),
        ).toBe("Every day")
        expect(describeCadence(state({cadence: "monthly", daysOfMonth: [1, 15]}), text)).toBe(
            "Monthly on the 1st and 15th",
        )
        expect(describeCadence(state({cadence: "monthly", daysOfMonth: [2, 3, 22]}), text)).toBe(
            "Monthly on the 2nd, 3rd and 22nd",
        )
        expect(
            describeCadence(
                state({cadence: "monthly", daysOfMonth: [1, 11, 13, 17, 18, 19, 31]}),
                text,
            ),
        ).toBe("Monthly on the 1st, 11th, 13th +4")
        expect(describeCadence(state({cadence: "weekly", weekdays: [1, 2, 3, 4, 6]}), text)).toBe(
            "Mon, Tue, Wed +2",
        )
        expect(describeCadence(state({cadence: "custom", cron: "*/5 * * * *"}), text)).toBe(
            "*/5 * * * *",
        )
    })

    it("summarizes a schedule with its run times", () => {
        const text = build()
        expect(
            summarizeSchedule(
                state({
                    cadence: "weekly",
                    weekdays: [1, 2, 3, 4, 5],
                    times: [{hour: 9, minute: 0}],
                }),
                text,
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
                text,
            ),
        ).toBe("Daily at 09:00 and 21:00 UTC")
        expect(
            summarizeSchedule(
                state({cadence: "hourly", everyNHours: 6, times: [{hour: 0, minute: 30}]}),
                text,
            ),
        ).toBe("Every 6h at :30 UTC")
        expect(summarizeSchedule(cronToBuilder("0 9 * * 1").state, text)).toBe("Mon at 09:00 UTC")
        // A hand-written day range is a weekly schedule the builder can show.
        expect(cronToBuilder("0 9 * * 1-5").representable).toBe(true)
        expect(summarizeSchedule(cronToBuilder("0 9 * * 1-5").state, text)).toBe(
            "Weekdays at 09:00 UTC",
        )
        expect(cronToBuilder("0 9 * * 0,5-6").state.weekdays).toEqual([0, 5, 6])
        expect(cronToBuilder("0 9 * * 5-2").representable).toBe(false)
        expect(describeSchedule("0 9 * * 1-5", text)).toBe("Weekdays at 09:00 UTC")
        expect(describeSchedule("0 9 1,15 * 1", text)).toBe("0 9 1,15 * 1 (UTC)")
        expect(summarizeSchedule(state({cadence: "custom", cron: "0 9 * * 1-5"}), text)).toBe(
            "0 9 * * 1-5",
        )
    })

    it("describes a raw cron expression", () => {
        const text = build()
        expect(describeCron("* * * * *", text)).toBe("Every minute (UTC)")
        expect(describeCron("*/5 * * * *", text)).toBe("Every 5 minutes (UTC)")
        expect(describeCron("0 * * * *", text)).toBe("Every hour (UTC)")
        expect(describeCron("5 * * * *", text)).toBe("Every hour at :05 (UTC)")
        expect(describeCron("30 */2 * * *", text)).toBe("Every 2 hours at :30 (UTC)")
        expect(describeCron("30 9 * * *", text)).toBe("Every day at 09:30 UTC")
        expect(describeCron("0 9 * * 1", text)).toBe("Every Monday at 09:00 UTC")
        expect(describeCron("0 9 * * 1-5", text)).toBe(
            "Monday, Tuesday, Wednesday, Thursday, Friday at 09:00 UTC",
        )
        expect(describeCron("0 9 1,15 * *", text)).toBe("0 9 1,15 * * (UTC)")
        expect(describeCron("nonsense", text)).toBe("nonsense")
    })

    it("names the next run in UTC with a relative gap", () => {
        const text = build()
        // Mon 2026-08-10, 08:00 UTC.
        const from = new Date("2026-08-10T08:00:00.000Z")
        expect(formatNextRun("0 9 * * *", text, undefined, from)).toBe(
            "Next run Mon 10 Aug, 09:00 UTC · in 1 hour",
        )
        expect(formatNextRun("0 9 * * 3", text, undefined, from)).toBe(
            "Next run Wed 12 Aug, 09:00 UTC · in 2 days",
        )
        expect(formatNextRun("30 8 * * *", text, undefined, from)).toBe(
            "Next run Mon 10 Aug, 08:30 UTC · in 30 minutes",
        )
        expect(
            formatNextRun(
                "0 0 * * *",
                text,
                state({cadence: "hourly", everyNHours: 23, times: [{hour: 0, minute: 0}]}),
                new Date("2026-09-14T08:00:00.000Z"),
            ),
        ).toBe("Next run Tue 15 Sep, 00:00 UTC · in 16 hours · 2 runs a day")
        const hourly = state({cadence: "hourly", everyNHours: 6, times: [{hour: 0, minute: 0}]})
        expect(formatNextRun("0 */6 * * *", text, hourly, from)).toBe(
            "Next run Mon 10 Aug, 12:00 UTC · in 4 hours · 4 runs a day",
        )
        expect(formatNextRun("not a cron", text, undefined, from)).toBe("")
    })

    it("suggests a schedule name", () => {
        const text = build()
        expect(
            suggestScheduleName(
                state({
                    cadence: "weekly",
                    weekdays: [1, 2, 3, 4, 5],
                    times: [{hour: 9, minute: 0}],
                }),
                text,
                "daily-update",
            ),
        ).toBe("Weekdays 09:00 — daily-update")
        expect(
            suggestScheduleName(
                state({cadence: "hourly", everyNHours: 2, times: [{hour: 0, minute: 0}]}),
                text,
                "daily-update",
            ),
        ).toBe("Every 2h at :00 — daily-update")
        expect(
            suggestScheduleName(state({cadence: "daily", times: [{hour: 9, minute: 0}]}), text),
        ).toBe("Daily 09:00")
    })
})

describe("englishScheduleText in another language", () => {
    afterEach(() => getDefaultStore().set(activeLanguageAtom, "en"))

    it("stays English while the screen shows another language", () => {
        getDefaultStore().set(activeLanguageAtom, "ja-JP")
        const weekly = cronToBuilder("0 9 * * 1,3").state
        expect(summarizeSchedule(weekly, englishScheduleText())).toBe("Mon and Wed at 09:00 UTC")
        expect(summarizeSchedule(weekly, scheduleTextNow())).not.toBe("Mon and Wed at 09:00 UTC")
    })
})
