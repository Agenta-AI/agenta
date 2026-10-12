import {describe, expect, it} from "vitest"

import {
    DASHBOARD_ERROR_FALLBACK,
    dashboardErrorMessage,
    isDashboardTimeout,
    shouldRetryDashboard,
} from "../../src/core/dashboardError"

const fernError = (statusCode: number, body: unknown) =>
    Object.assign(new Error(`Status code: ${statusCode}`), {statusCode, body})

describe("dashboardErrorMessage", () => {
    it("uses the server's detail", () => {
        const error = fernError(504, {detail: "The analytics query took too long."})

        expect(dashboardErrorMessage(error)).toBe("The analytics query took too long.")
    })

    it("falls back when the body has no detail (a proxy's HTML page)", () => {
        expect(dashboardErrorMessage(fernError(502, "<html>Bad Gateway</html>"))).toBe(
            DASHBOARD_ERROR_FALLBACK,
        )
        expect(dashboardErrorMessage(new Error("network"))).toBe(DASHBOARD_ERROR_FALLBACK)
    })
})

describe("isDashboardTimeout", () => {
    it("is true only for a 504", () => {
        expect(isDashboardTimeout(fernError(504, {}))).toBe(true)
        expect(isDashboardTimeout(fernError(500, {}))).toBe(false)
        expect(isDashboardTimeout(new Error("network"))).toBe(false)
    })
})

describe("shouldRetryDashboard", () => {
    it("does not retry a 504 or a 4xx", () => {
        expect(shouldRetryDashboard(0, fernError(504, {}))).toBe(false)
        expect(shouldRetryDashboard(0, fernError(400, {}))).toBe(false)
        expect(shouldRetryDashboard(0, fernError(403, {}))).toBe(false)
    })

    it("retries a transient 5xx or a network failure up to three times", () => {
        expect(shouldRetryDashboard(0, fernError(502, {}))).toBe(true)
        expect(shouldRetryDashboard(2, new Error("network"))).toBe(true)
        expect(shouldRetryDashboard(3, new Error("network"))).toBe(false)
    })
})
