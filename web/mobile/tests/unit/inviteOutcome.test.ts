import {describe, expect, it} from "vitest"

import {inviteFailure} from "@/features/invite/inviteOutcome"

const apiError = (status: number, error?: string) => ({
    response: {status, data: {detail: error ? {error, message: "raw"} : "raw"}},
})

describe("a failed invite accept", () => {
    it("treats an accepted invite as success", () => {
        expect(inviteFailure(apiError(409, "INVITE_ALREADY_ACCEPTED")).alreadyAccepted).toBe(true)
        expect(inviteFailure(apiError(409)).alreadyAccepted).toBe(true)
    })

    it.each([
        ["INVITE_EMAIL_MISMATCH", 400, "This invitation is not for you."],
        ["INVITE_EXPIRED", 410, "This invitation has expired."],
        ["INVITE_NOT_FOUND", 400, "This invitation is not valid."],
    ])("gives %s its own message and no retry", (code, status, text) => {
        const failure = inviteFailure(apiError(status, code))
        expect(failure.message).toContain(text)
        expect(failure).toMatchObject({alreadyAccepted: false, retryable: false})
    })

    it("offers a retry and hides the raw detail on anything else", () => {
        const failure = inviteFailure(apiError(500))
        expect(failure.retryable).toBe(true)
        expect(failure.message).not.toContain("raw")
        expect(inviteFailure(new Error("Network Error")).retryable).toBe(true)
    })
})
