/**
 * Unit tests for the bounded run-request build (#6042).
 *
 * Regression: `prepareSendMessagesRequest` could park a send forever — a not-yet-loaded workflow
 * failed instantly ("no invocation URL"), and a hung await inside the build (the auth-header
 * fetch) left the chat in "submitted" with no error and no network request, a spinner that
 * survived reloads.
 */
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

import {
    buildRequestWithinDeadline,
    PREPARE_HUNG_MESSAGE,
    PREPARE_NOT_READY_MESSAGE,
} from "./boundedRequest"

describe("buildRequestWithinDeadline", () => {
    beforeEach(() => {
        vi.useFakeTimers()
    })
    afterEach(() => {
        vi.useRealTimers()
    })

    it("returns the request when the build resolves immediately", async () => {
        const result = buildRequestWithinDeadline(async () => "req")
        await expect(result).resolves.toBe("req")
    })

    it("retries a null build (workflow still loading) until it resolves", async () => {
        let calls = 0
        const build = async () => (++calls < 3 ? null : "req")
        const result = buildRequestWithinDeadline(build, {timeoutMs: 5_000, retryMs: 100})
        await vi.advanceTimersByTimeAsync(1_000)
        await expect(result).resolves.toBe("req")
        expect(calls).toBe(3)
    })

    it("fails with the not-ready error when the build never yields a request", async () => {
        const result = buildRequestWithinDeadline(async () => null, {
            timeoutMs: 1_000,
            retryMs: 100,
        })
        // Attach the handler before advancing so the rejection is never unhandled.
        const outcome = expect(result).rejects.toThrow(PREPARE_NOT_READY_MESSAGE)
        await vi.advanceTimersByTimeAsync(2_000)
        await outcome
    })

    it("fails with the timeout error when the build hangs", async () => {
        const result = buildRequestWithinDeadline(() => new Promise<never>(() => {}), {
            timeoutMs: 1_000,
        })
        const outcome = expect(result).rejects.toThrow(PREPARE_HUNG_MESSAGE)
        await vi.advanceTimersByTimeAsync(2_000)
        await outcome
    })
})
