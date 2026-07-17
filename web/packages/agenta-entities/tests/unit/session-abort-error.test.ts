import {describe, expect, it, vi} from "vitest"

import {callFern, isAbortError} from "../../src/session/api/client"

/** Mirrors Fern's `AgentaApiError`: an aborted request is repackaged, not rethrown as
 * the raw `AbortError` — the original `DOMException` lands on `.cause`. */
class FernApiErrorLike extends Error {
    cause?: unknown
    constructor(message: string, cause?: unknown) {
        super(message)
        this.name = "AgentaApiError"
        if (cause != null) this.cause = cause
    }
}

describe("isAbortError", () => {
    it("detects a raw AbortError DOMException", () => {
        expect(isAbortError(new DOMException("aborted", "AbortError"))).toBe(true)
    })

    it("detects a raw TimeoutError DOMException", () => {
        expect(isAbortError(new DOMException("timed out", "TimeoutError"))).toBe(true)
    })

    it("detects a plain object with name AbortError", () => {
        expect(isAbortError({name: "AbortError"})).toBe(true)
    })

    it("detects Fern's repackaged abort via message marker", () => {
        expect(isAbortError(new FernApiErrorLike("The user aborted a request"))).toBe(true)
    })

    it("detects Fern's repackaged abort via the cause chain", () => {
        const cause = new DOMException("aborted", "AbortError")
        expect(isAbortError(new FernApiErrorLike("wrapped", cause))).toBe(true)
    })

    it("returns false for a real API failure", () => {
        expect(isAbortError(new FernApiErrorLike("Status code: 500"))).toBe(false)
    })

    it("returns false for null/undefined/strings", () => {
        expect(isAbortError(null)).toBe(false)
        expect(isAbortError(undefined)).toBe(false)
        expect(isAbortError("nope")).toBe(false)
    })
})

describe("callFern", () => {
    it("rethrows aborts so the query client cancels cleanly, without logging", async () => {
        const spy = vi.spyOn(console, "error").mockImplementation(() => {})
        const abort = new FernApiErrorLike("The user aborted a request")
        await expect(callFern("[test]", () => Promise.reject(abort))).rejects.toBe(abort)
        expect(spy).not.toHaveBeenCalled()
        spy.mockRestore()
    })

    it("logs and returns null for a real failure", async () => {
        const spy = vi.spyOn(console, "error").mockImplementation(() => {})
        const result = await callFern("[test]", () =>
            Promise.reject(new FernApiErrorLike("Status code: 500")),
        )
        expect(result).toBeNull()
        expect(spy).toHaveBeenCalledOnce()
        spy.mockRestore()
    })
})
