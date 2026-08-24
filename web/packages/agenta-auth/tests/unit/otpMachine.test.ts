import {describe, expect, it} from "vitest"

import {
    describeConsumeCode,
    describeCreateCode,
    describeResendCode,
    initialOtpState,
    otpReducer,
    type OtpState,
} from "../../src/otpMachine"

const at = (overrides: Partial<OtpState> = {}): OtpState => ({
    ...initialOtpState("a@b.co"),
    ...overrides,
})

describe("otpReducer", () => {
    it("starts on the email step", () => {
        expect(initialOtpState().phase).toBe("email")
    })

    it("clears the error as soon as the user edits a field", () => {
        const state = otpReducer(at({error: "Incorrect code."}), {type: "edit-code", value: "1"})
        expect(state).toMatchObject({code: "1", error: null})
    })

    it("moves to the code step once the code is sent, wiping stale input", () => {
        const sending = otpReducer(at({code: "999999"}), {type: "send"})
        expect(sending.phase).toBe("sending")
        expect(otpReducer(sending, {type: "sent"})).toMatchObject({phase: "code", code: ""})
    })

    it("returns to the email step when sending fails", () => {
        const failed = otpReducer(at({phase: "sending"}), {type: "failed", message: "nope"})
        expect(failed).toMatchObject({phase: "email", error: "nope"})
    })

    it("stays on the code step when verification fails, keeping the email", () => {
        const failed = otpReducer(at({phase: "verifying"}), {type: "failed", message: "bad code"})
        expect(failed).toMatchObject({phase: "code", error: "bad code", email: "a@b.co"})
    })

    it("blocks resend until the cooldown event, and shows a notice", () => {
        const resent = otpReducer(at({phase: "code"}), {type: "resent"})
        expect(resent).toMatchObject({resendBlocked: true, notice: "New code sent.", error: null})
        expect(otpReducer(resent, {type: "resend-allowed"}).resendBlocked).toBe(false)
    })

    it("drops the notice when a new attempt starts", () => {
        const resent = otpReducer(at({phase: "code"}), {type: "resent"})
        expect(otpReducer(resent, {type: "verify"}).notice).toBeNull()
    })

    it("restart keeps the typed email but resets everything else", () => {
        const restarted = otpReducer(at({phase: "code", code: "123456", resendBlocked: true}), {
            type: "restart",
            message: "expired",
        })
        expect(restarted).toEqual({
            phase: "email",
            email: "a@b.co",
            code: "",
            error: "expired",
            notice: null,
            resendBlocked: false,
        })
    })

    it("restart without a message clears the error too", () => {
        expect(otpReducer(at({error: "x"}), {type: "restart"}).error).toBeNull()
    })
})

describe("describeCreateCode", () => {
    it("accepts OK", () => {
        expect(describeCreateCode({status: "OK"})).toEqual({kind: "ok"})
    })
    it("surfaces the backend reason when sign-in is not allowed", () => {
        expect(describeCreateCode({status: "SIGN_IN_UP_NOT_ALLOWED", reason: "blocked"})).toEqual({
            kind: "failed",
            message: "blocked",
        })
    })
    it("falls back to a generic message on a thrown/unknown result", () => {
        expect(describeCreateCode(null).kind).toBe("failed")
    })
})

describe("describeResendCode", () => {
    it("accepts OK", () => {
        expect(describeResendCode({status: "OK"})).toEqual({kind: "ok"})
    })
    it("restarts the flow on RESTART_FLOW_ERROR", () => {
        expect(describeResendCode({status: "RESTART_FLOW_ERROR"}).kind).toBe("restart")
    })
    it("restarts on an unknown result", () => {
        expect(describeResendCode(null).kind).toBe("restart")
    })
})

describe("describeConsumeCode", () => {
    it("accepts OK", () => {
        expect(describeConsumeCode({status: "OK"})).toEqual({kind: "ok"})
    })

    it("reports the remaining attempts on a wrong code", () => {
        expect(
            describeConsumeCode({
                status: "INCORRECT_USER_INPUT_CODE_ERROR",
                failedCodeInputAttemptCount: 3,
                maximumCodeInputAttempts: 5,
            }),
        ).toEqual({kind: "retry", message: "Incorrect code. 2 attempts left."})
    })

    it("singularizes the last attempt", () => {
        expect(
            describeConsumeCode({
                status: "INCORRECT_USER_INPUT_CODE_ERROR",
                failedCodeInputAttemptCount: 4,
                maximumCodeInputAttempts: 5,
            }),
        ).toEqual({kind: "retry", message: "Incorrect code. 1 attempt left."})
    })

    it("omits the count when no attempts remain", () => {
        expect(
            describeConsumeCode({
                status: "INCORRECT_USER_INPUT_CODE_ERROR",
                failedCodeInputAttemptCount: 5,
                maximumCodeInputAttempts: 5,
            }),
        ).toEqual({kind: "retry", message: "Incorrect code."})
    })

    it("keeps the user on the code step when the code expired", () => {
        expect(describeConsumeCode({status: "EXPIRED_USER_INPUT_CODE_ERROR"}).kind).toBe("retry")
    })

    it("restarts on RESTART_FLOW_ERROR", () => {
        expect(describeConsumeCode({status: "RESTART_FLOW_ERROR"}).kind).toBe("restart")
    })

    it("restarts with the backend reason when sign-in is not allowed", () => {
        expect(describeConsumeCode({status: "SIGN_IN_UP_NOT_ALLOWED", reason: "linked"})).toEqual({
            kind: "restart",
            message: "linked",
        })
    })

    it("restarts on a thrown/unknown result", () => {
        expect(describeConsumeCode(null).kind).toBe("restart")
    })
})
