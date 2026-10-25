/**
 * A send refused with 403 (QA D5: /w, a member without "Can send" sends to a chat they can
 * read) says why, not "try again": sending again fails the same way.
 */
import {describe, expect, it} from "vitest"

import {ACCESS_REFUSED_REASON, describeRefusedSend, readSendRefusal} from "../../../src/model/error"

describe("a send refused for access", () => {
    it("a 403 with no stated reason names the access refusal", () => {
        const refusal = readSendRefusal(403, "Forbidden")
        expect(refusal.statedReason).toBe(ACCESS_REFUSED_REASON)
        expect(describeRefusedSend(refusal)).toBe(`wasn't sent — ${ACCESS_REFUSED_REASON}`)
        expect(describeRefusedSend(refusal)).not.toContain("try again")
    })

    it("a 403 that states its own reason keeps it", () => {
        const body = JSON.stringify({
            detail: {code: "access_denied", message: "You are not a member of this project."},
        })
        expect(readSendRefusal(403, body).statedReason).toContain(
            "You are not a member of this project",
        )
    })

    it("another refusal with no reason still says try again", () => {
        expect(describeRefusedSend(readSendRefusal(500, ""))).toContain("try again")
    })
})

it("a 403 of another error type names the access refusal too", () => {
    const error = Object.assign(new Error("Forbidden"), {status: 403})
    expect(describeRefusedSend(error)).toBe(`wasn't sent — ${ACCESS_REFUSED_REASON}`)
})
