import {describe, expect, it} from "vitest"

import {parseNotice} from "./MaintenanceNotice"

/**
 * The payload is remote configuration. Someone edits it in PostHog, under time
 * pressure, during a migration window, and it reaches every browser within a
 * minute without passing review. So the parser has to treat it as data and never
 * assume a shape.
 *
 * The rule these tests pin: a payload we cannot read is NO notice. Never a bar with
 * "undefined" in it, and never a link we did not mean to render.
 */
describe("parseNotice", () => {
    it("reads a complete payload", () => {
        expect(
            parseNotice({
                id: "us-cutover-2026-10",
                message: "Agenta moves to new infrastructure on 15 October.",
                linkHref: "https://status.agenta.ai",
                linkLabel: "Details",
                tone: "warning",
            }),
        ).toEqual({
            id: "us-cutover-2026-10",
            message: "Agenta moves to new infrastructure on 15 October.",
            linkHref: "https://status.agenta.ai",
            linkLabel: "Details",
            tone: "warning",
        })
    })

    it("needs only a message", () => {
        const notice = parseNotice({message: "Back shortly."})
        expect(notice?.message).toBe("Back shortly.")
        expect(notice?.tone).toBe("info")
        expect(notice?.linkHref).toBeUndefined()
    })

    it("falls back to the message as the id, so a reworded notice reappears", () => {
        // Someone who edits the words without touching the id would otherwise leave
        // every reader who dismissed the old one unable to see the new one.
        expect(parseNotice({message: "First wording."})?.id).toBe("First wording.")
        expect(parseNotice({message: "Second wording."})?.id).toBe("Second wording.")
    })

    it.each([
        ["nothing", undefined],
        ["null", null],
        ["a string", "we are down"],
        ["an array", [{message: "hi"}]],
        ["an empty object", {}],
        ["a blank message", {message: "   "}],
        ["a message that is not a string", {message: 42}],
    ])("treats %s as no notice", (_label, payload) => {
        expect(parseNotice(payload)).toBeNull()
    })

    it("refuses a link that is not http or https", () => {
        // A payload is not a place from which to run script.
        for (const href of ["javascript:alert(1)", "data:text/html,x", "/relative", "ftp://h/x"]) {
            const notice = parseNotice({message: "m", linkHref: href})
            expect(notice?.linkHref).toBeUndefined()
            expect(notice?.linkLabel).toBeUndefined()
        }
    })

    it("gives a link a label when the payload forgot one", () => {
        const notice = parseNotice({message: "m", linkHref: "https://status.agenta.ai"})
        expect(notice?.linkLabel).toBe("Read more")
    })

    it("caps the message, because the bar is one line and the app sits under it", () => {
        const notice = parseNotice({message: "x".repeat(1000)})
        expect(notice?.message).toHaveLength(240)
    })

    it("treats any tone it does not know as info", () => {
        expect(parseNotice({message: "m", tone: "disaster"})?.tone).toBe("info")
        expect(parseNotice({message: "m"})?.tone).toBe("info")
    })
})
