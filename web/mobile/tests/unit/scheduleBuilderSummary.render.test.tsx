// @vitest-environment jsdom
/**
 * The "Runs when" field reads its words from `useScheduleBuilder`. A cron the builder cannot
 * show ("*\/15 * * * *") used to come back as the raw expression; it now reads as the automation
 * row reads it.
 */
import {describeSchedule} from "@agenta/entities/gatewayTrigger"
import {scheduleTextNow, useScheduleBuilder} from "@agenta/entity-ui/gatewayTrigger"
import {renderHook} from "@testing-library/react"
import {describe, expect, it} from "vitest"

const summaryOf = (cron: string) =>
    renderHook(() => useScheduleBuilder(cron, () => undefined)).result.current.summary

describe("the schedule summary", () => {
    it("describes a cron the builder cannot show, as the automation row does", () => {
        const summary = summaryOf("*/15 * * * *")
        expect(summary).toBe("Every 15 minutes (UTC)")
        expect(summary).toBe(describeSchedule("*/15 * * * *", scheduleTextNow()))
    })

    it("keeps the builder's words for a cron it can show", () => {
        expect(summaryOf("0 9 * * 1,2,3,4,5")).toBe("Weekdays at 09:00 UTC")
    })

    it("shows an invalid expression as typed", () => {
        expect(summaryOf("not a cron")).toBe("not a cron")
    })
})
