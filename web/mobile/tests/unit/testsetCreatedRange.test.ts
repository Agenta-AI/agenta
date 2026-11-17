import {describe, expect, it} from "vitest"

import {createdFilterFor} from "@/features/testsets/list/testsetCreatedRange"

const local = (iso: string | undefined) => {
    const date = new Date(iso ?? "")
    return [date.getFullYear(), date.getMonth() + 1, date.getDate()]
}

describe("the Date Created ranges", () => {
    it("Last month on March 31 starts on the last day of February, not in March", () => {
        const filter = createdFilterFor("1m", new Date(2026, 2, 31, 12))
        expect(local(filter?.createdAfter)).toEqual([2026, 2, 28])
    })

    it("Last 3 months on May 31 starts on the last day of February", () => {
        const filter = createdFilterFor("3m", new Date(2026, 4, 31, 12))
        expect(local(filter?.createdAfter)).toEqual([2026, 2, 28])
    })

    it("Last month keeps the day when the earlier month has it", () => {
        const filter = createdFilterFor("1m", new Date(2026, 6, 15, 12))
        expect(local(filter?.createdAfter)).toEqual([2026, 6, 15])
    })

    it("Last month on January 31 goes back across the year", () => {
        const filter = createdFilterFor("1m", new Date(2026, 0, 31, 12))
        expect(local(filter?.createdAfter)).toEqual([2025, 12, 31])
    })

    it("All time has no filter", () => {
        expect(createdFilterFor("all", new Date(2026, 2, 31))).toBeNull()
    })
})
