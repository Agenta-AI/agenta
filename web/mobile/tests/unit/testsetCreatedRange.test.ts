import {describe, expect, it} from "vitest"

import {createdFilterFor} from "@/features/testsets/list/testsetCreatedRange"

const local = (iso: string | undefined) => {
    const date = new Date(iso ?? "")
    return [date.getFullYear(), date.getMonth() + 1, date.getDate()]
}

describe("the Date Created ranges", () => {
    it.each([
        {
            name: "Last month on March 31 starts on the last day of February, not in March",
            range: "1m",
            now: new Date(2026, 2, 31, 12),
            start: [2026, 2, 28],
        },
        {
            name: "Last 3 months on May 31 starts on the last day of February",
            range: "3m",
            now: new Date(2026, 4, 31, 12),
            start: [2026, 2, 28],
        },
        {
            name: "Last month keeps the day when the earlier month has it",
            range: "1m",
            now: new Date(2026, 6, 15, 12),
            start: [2026, 6, 15],
        },
        {
            name: "Last month on January 31 goes back across the year",
            range: "1m",
            now: new Date(2026, 0, 31, 12),
            start: [2025, 12, 31],
        },
    ] as const)("$name", ({range, now, start}) => {
        expect(local(createdFilterFor(range, now)?.createdAfter)).toEqual(start)
    })

    it("All time has no filter", () => {
        expect(createdFilterFor("all", new Date(2026, 2, 31))).toBeNull()
    })
})
