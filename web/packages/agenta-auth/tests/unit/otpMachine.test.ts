import {describe, expect, it} from "vitest"

import {describeCreateCode, describeResendCode} from "../../src/otpMachine"

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
