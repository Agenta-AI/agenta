import {describe, expect, it} from "vitest"

import {
    LOGIN_ATTEMPT_BACKSTOP_MS,
    MIN_LOGIN_POLL_MS,
    isTerminalLoginAttemptState,
} from "../../src/secret/api/loginAttempts"
import {
    loginAttemptKey,
    loginAttemptOutcome,
    loginAttemptPollInterval,
} from "../../src/secret/state/subscriptionLogin"

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

describe("loginAttemptOutcome", () => {
    const outcome = (over: Record<string, unknown> = {}) =>
        loginAttemptOutcome({
            state: "pending",
            startedAt: STARTED_AT,
            now: STARTED_AT + 1000,
            ...over,
        })

    it("waits while the server keeps answering pending", () => {
        expect(outcome()).toBe("waiting")
        expect(outcome({state: undefined})).toBe("waiting")
    })

    it("reports the server's own endings", () => {
        expect(outcome({state: "succeeded"})).toBe("succeeded")
        for (const state of ["failed", "expired", "cancelled"]) {
            expect(outcome({state})).toBe("failed")
        }
    })

    /**
     * A sign-in whose response was lost has already landed on the row, and the row then cleared
     * the binding, so the next poll reads 404 exactly like a stranger's attempt id. The card must
     * ask the vault rather than show a failure over a connection that is ready.
     */
    it("calls a poll it could not read unreadable, ahead of every other ending", () => {
        expect(outcome({unreadable: true})).toBe("unreadable")
        expect(outcome({unreadable: true, state: "failed"})).toBe("unreadable")
        expect(outcome({unreadable: true, now: STARTED_AT + LOGIN_ATTEMPT_BACKSTOP_MS + 1})).toBe(
            "unreadable",
        )
    })

    it("times out an attempt the server never ended, on the poll's own backstop", () => {
        expect(outcome({now: STARTED_AT + LOGIN_ATTEMPT_BACKSTOP_MS - 1})).toBe("waiting")
        expect(outcome({now: STARTED_AT + LOGIN_ATTEMPT_BACKSTOP_MS})).toBe("timed_out")
        // The poll stops on the same clock, so the two never disagree.
        expect(
            loginAttemptPollInterval({
                state: "pending",
                startedAt: STARTED_AT,
                now: STARTED_AT + LOGIN_ATTEMPT_BACKSTOP_MS + 1,
            }),
        ).toBe(false)
    })

    it("still reports a success that arrived after the backstop", () => {
        expect(outcome({state: "succeeded", now: STARTED_AT + LOGIN_ATTEMPT_BACKSTOP_MS + 1})).toBe(
            "succeeded",
        )
    })
})
