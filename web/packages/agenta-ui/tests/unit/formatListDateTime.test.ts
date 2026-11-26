import {describe, expect, it} from "vitest"

import {formatListDateTime} from "../../src/list-table/formatListDateTime"

describe("list date and time", () => {
    it("shows the date and the time like the classic app", () => {
        // Local time, so the expected text holds in every time zone.
        expect(formatListDateTime(new Date(2026, 10, 5, 19, 32), "en-US")).toBe(
            "Nov 5, 2026, 7:32 PM",
        )
    })

    it("tells apart two items made on the same day", () => {
        const morning = formatListDateTime(new Date(2026, 10, 5, 9, 5), "en-US")
        const evening = formatListDateTime(new Date(2026, 10, 5, 19, 32), "en-US")
        expect(morning).toBe("Nov 5, 2026, 9:05 AM")
        expect(morning).not.toBe(evening)
    })

    it("reads an ISO string", () => {
        const iso = new Date(2026, 0, 2, 13, 0).toISOString()
        expect(formatListDateTime(iso, "en-US")).toBe("Jan 2, 2026, 1:00 PM")
    })

    it.each([null, undefined, "", "not a date"])("shows a dash for %j", (value) => {
        expect(formatListDateTime(value, "en-US")).toBe("—")
    })
})
