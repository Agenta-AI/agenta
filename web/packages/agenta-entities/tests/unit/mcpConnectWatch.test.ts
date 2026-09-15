/**
 * The consent watch owns a listener, a poll and a timeout. Closing the dialog while the popup is
 * still open used to leave all three behind, and every reopen added another set (OR67), so the
 * teardown is asserted here rather than left to a reviewer reading the dialog.
 */
import {describe, expect, it, vi} from "vitest"

import {
    buildTrustedOrigins,
    CONSENT_CLOSED_MESSAGE,
    CONSENT_FAILED_MESSAGE,
    CONSENT_TIMEOUT_MESSAGE,
    watchOauthConsent,
    type OauthConsentTarget,
    type OauthConsentTimers,
} from "../../src/mcpEndpoint/core"

const TRUSTED = "https://api.example.test"
const trustedOrigins = buildTrustedOrigins([`${TRUSTED}/gateways/mcps`])

/** A message target that records what is still attached. */
const makeTarget = () => {
    const listeners = new Set<(event: MessageEvent) => void>()
    const target: OauthConsentTarget = {
        addEventListener: (_type, listener) => void listeners.add(listener),
        removeEventListener: (_type, listener) => void listeners.delete(listener),
    }
    const post = (data: unknown, origin = TRUSTED) => {
        for (const listener of [...listeners]) listener({data, origin} as MessageEvent)
    }
    return {target, listeners, post}
}

/** Manual timers so the poll and the timeout can be fired without waiting three minutes. */
const makeTimers = () => {
    const intervals = new Map<number, () => void>()
    const timeouts = new Map<number, () => void>()
    let next = 1
    const timers: OauthConsentTimers = {
        setInterval: (callback) => {
            const handle = next++
            intervals.set(handle, callback)
            return handle
        },
        clearInterval: (handle) => void intervals.delete(handle as number),
        setTimeout: (callback) => {
            const handle = next++
            timeouts.set(handle, callback)
            return handle
        },
        clearTimeout: (handle) => void timeouts.delete(handle as number),
    }
    const tickPoll = () => {
        for (const callback of [...intervals.values()]) callback()
    }
    const fireTimeout = () => {
        for (const callback of [...timeouts.values()]) callback()
    }
    return {timers, intervals, timeouts, tickPoll, fireTimeout}
}

const setup = (overrides: {popup?: {closed: boolean}; endpointId?: string} = {}) => {
    const {target, listeners, post} = makeTarget()
    const {timers, intervals, timeouts, tickPoll, fireTimeout} = makeTimers()
    const onConnected = vi.fn()
    const onFailed = vi.fn()
    const popup = overrides.popup ?? {closed: false}

    const stop = watchOauthConsent({
        popup,
        endpointId: overrides.endpointId ?? "mcp-1",
        trustedOrigins,
        target,
        onConnected,
        onFailed,
        timers,
    })

    return {
        stop,
        popup,
        listeners,
        intervals,
        timeouts,
        post,
        tickPoll,
        fireTimeout,
        onConnected,
        onFailed,
    }
}

const attached = (w: ReturnType<typeof setup>) => ({
    listeners: w.listeners.size,
    intervals: w.intervals.size,
    timeouts: w.timeouts.size,
})

describe("watchOauthConsent teardown", () => {
    it("attaches exactly one listener, one poll and one timeout", () => {
        const watch = setup()

        expect(attached(watch)).toEqual({listeners: 1, intervals: 1, timeouts: 1})
    })

    it("releases all three when stopped with the popup still open", () => {
        const watch = setup()

        watch.stop()

        expect(watch.popup.closed).toBe(false)
        expect(attached(watch)).toEqual({listeners: 0, intervals: 0, timeouts: 0})
    })

    it("leaves nothing attached after a successful completion", () => {
        const watch = setup()

        watch.post({type: "mcp:oauth:connected", success: true, endpoint_id: "mcp-1"})

        expect(watch.onConnected).toHaveBeenCalledOnce()
        expect(attached(watch)).toEqual({listeners: 0, intervals: 0, timeouts: 0})
    })

    it("is idempotent, so stopping after an outcome does not report a second one", () => {
        const watch = setup()

        watch.post({type: "mcp:oauth:connected", success: true})
        watch.stop()
        watch.stop()

        expect(watch.onConnected).toHaveBeenCalledOnce()
        expect(watch.onFailed).not.toHaveBeenCalled()
    })

    it("delivers no outcome once stopped, however late the message arrives", () => {
        const watch = setup()

        watch.stop()
        watch.post({type: "mcp:oauth:connected", success: true})
        watch.tickPoll()
        watch.fireTimeout()

        expect(watch.onConnected).not.toHaveBeenCalled()
        expect(watch.onFailed).not.toHaveBeenCalled()
    })
})

describe("watchOauthConsent outcomes", () => {
    it("reports the callback's own error on an explicit failure", () => {
        const watch = setup()

        watch.post({type: "mcp:oauth:connected", success: false, error: "User declined"})

        expect(watch.onFailed).toHaveBeenCalledWith("User declined")
    })

    it("falls back to a sentence when a failed completion carries no error", () => {
        const watch = setup()

        watch.post({type: "mcp:oauth:connected", success: false})

        expect(watch.onFailed).toHaveBeenCalledWith(CONSENT_FAILED_MESSAGE)
    })

    it("treats a closed popup as a failure, not as success", () => {
        const popup = {closed: false}
        const watch = setup({popup})

        popup.closed = true
        watch.tickPoll()

        expect(watch.onConnected).not.toHaveBeenCalled()
        expect(watch.onFailed).toHaveBeenCalledWith(CONSENT_CLOSED_MESSAGE)
    })

    it("terminates an attempt nobody ever finished", () => {
        const watch = setup()

        watch.fireTimeout()

        expect(watch.onFailed).toHaveBeenCalledWith(CONSENT_TIMEOUT_MESSAGE)
        expect(attached(watch)).toEqual({listeners: 0, intervals: 0, timeouts: 0})
    })

    it("keeps waiting while the popup is open and no message has arrived", () => {
        const watch = setup()

        watch.tickPoll()
        watch.tickPoll()

        expect(watch.onConnected).not.toHaveBeenCalled()
        expect(watch.onFailed).not.toHaveBeenCalled()
        expect(attached(watch)).toEqual({listeners: 1, intervals: 1, timeouts: 1})
    })
})

describe("watchOauthConsent trust", () => {
    it("ignores a completion posted from an untrusted origin", () => {
        const watch = setup()

        watch.post({type: "mcp:oauth:connected", success: true}, "https://evil.test")

        expect(watch.onConnected).not.toHaveBeenCalled()
        expect(attached(watch).listeners).toBe(1)
    })

    it("ignores a completion that names a different endpoint", () => {
        const watch = setup({endpointId: "mcp-1"})

        watch.post({type: "mcp:oauth:connected", success: true, endpoint_id: "mcp-2"})

        expect(watch.onConnected).not.toHaveBeenCalled()
        expect(attached(watch).listeners).toBe(1)
    })

    it("accepts a completion that names this endpoint", () => {
        const watch = setup({endpointId: "mcp-1"})

        watch.post({type: "mcp:oauth:connected", success: true, endpoint_id: "mcp-1"})

        expect(watch.onConnected).toHaveBeenCalledOnce()
    })
})
