import {describe, expect, it} from "vitest"

import {
    LOGIN_ATTEMPT_BACKSTOP_MS,
    MIN_LOGIN_POLL_MS,
    isTerminalLoginAttemptState,
} from "../../src/secret/api/loginAttempts"
import {loginAttemptKey, loginAttemptPollInterval} from "../../src/secret/state/subscriptionLogin"

const STARTED_AT = 1_700_000_000_000

describe("isTerminalLoginAttemptState", () => {
    it("keeps polling only while the server says pending", () => {
        expect(isTerminalLoginAttemptState("pending")).toBe(false)
        for (const state of ["succeeded", "failed", "expired", "cancelled"]) {
            expect(isTerminalLoginAttemptState(state)).toBe(true)
        }
    })

    it("treats a missing state as not terminal, so a first answer is awaited", () => {
        expect(isTerminalLoginAttemptState(undefined)).toBe(false)
        expect(isTerminalLoginAttemptState(null)).toBe(false)
    })
})

describe("loginAttemptPollInterval", () => {
    it("uses the interval the server asked for", () => {
        expect(
            loginAttemptPollInterval({
                state: "pending",
                pollAfterMs: 5000,
                startedAt: STARTED_AT,
                now: STARTED_AT + 1000,
            }),
        ).toBe(5000)
    })

    it("never polls faster than the floor, whatever the server sends", () => {
        expect(
            loginAttemptPollInterval({
                state: "pending",
                pollAfterMs: 10,
                startedAt: STARTED_AT,
                now: STARTED_AT,
            }),
        ).toBe(MIN_LOGIN_POLL_MS)
        expect(
            loginAttemptPollInterval({state: "pending", startedAt: STARTED_AT, now: STARTED_AT}),
        ).toBe(MIN_LOGIN_POLL_MS)
    })

    it("stops on every terminal state", () => {
        for (const state of ["succeeded", "failed", "expired", "cancelled"]) {
            expect(
                loginAttemptPollInterval({
                    state,
                    pollAfterMs: 5000,
                    startedAt: STARTED_AT,
                    now: STARTED_AT + 1000,
                }),
            ).toBe(false)
        }
    })

    it("stops at the backstop even while the server keeps answering pending", () => {
        expect(
            loginAttemptPollInterval({
                state: "pending",
                pollAfterMs: 5000,
                startedAt: STARTED_AT,
                now: STARTED_AT + LOGIN_ATTEMPT_BACKSTOP_MS + 1,
            }),
        ).toBe(false)
        // One millisecond earlier it is still running: the backstop is a limit, not a rounding.
        expect(
            loginAttemptPollInterval({
                state: "pending",
                pollAfterMs: 5000,
                startedAt: STARTED_AT,
                now: STARTED_AT + LOGIN_ATTEMPT_BACKSTOP_MS - 1,
            }),
        ).toBe(5000)
    })
})

describe("loginAttemptKey", () => {
    it("is a value, so two renders of one attempt share a single poll", () => {
        const first = loginAttemptKey({
            secretId: "sub-1",
            attemptId: "att-1",
            startedAt: STARTED_AT,
        })
        const second = loginAttemptKey({
            secretId: "sub-1",
            attemptId: "att-1",
            startedAt: STARTED_AT,
        })
        expect(first).toBe(second)
    })

    it("separates two attempts on the same connection", () => {
        expect(
            loginAttemptKey({secretId: "sub-1", attemptId: "att-1", startedAt: STARTED_AT}),
        ).not.toBe(loginAttemptKey({secretId: "sub-1", attemptId: "att-2", startedAt: STARTED_AT}))
    })
})
