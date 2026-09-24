import {beforeEach, describe, expect, it, vi} from "vitest"

const state = vi.hoisted(() => ({key: "test-key", cloud: false, init: vi.fn(), reset: vi.fn()}))
vi.mock("@/lib/env", () => ({getEnv: () => state.key}))
vi.mock("@agenta/shared/api/env", () => ({isEE: () => state.cloud}))
vi.mock("posthog-js", () => ({default: {init: state.init, reset: state.reset}}))

beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    state.key = "test-key"
    state.cloud = false
    state.init.mockImplementation((_key, config) => config.loaded({reset: state.reset}))
})

describe("loading PostHog", () => {
    it("uses desktop OSS persistence and deduplicates concurrent loads", async () => {
        const {loadPostHog} = await import("@/features/analytics/client")
        const [a, b] = await Promise.all([loadPostHog(), loadPostHog()])
        expect(a).toBe(b)
        expect(state.init).toHaveBeenCalledTimes(1)
        expect(state.init.mock.calls[0][1]).toMatchObject({persistence: "localStorage+cookie"})
        expect(state.init.mock.calls[0][1]).not.toHaveProperty("session_recording")
    })

    it("never initializes when the project key is empty", async () => {
        state.key = ""
        const {loadPostHog} = await import("@/features/analytics/client")
        expect(await loadPostHog()).toBeNull()
        expect(state.init).not.toHaveBeenCalled()
    })

    it("bounds initialization failures and does not reject into the app", async () => {
        state.init.mockImplementation(() => {
            throw new Error("blocked")
        })
        const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined)
        const {loadPostHog} = await import("@/features/analytics/client")
        expect(await loadPostHog()).toBeNull()
        expect(await loadPostHog()).toBeNull()
        expect(state.init).toHaveBeenCalledTimes(3)
        warning.mockRestore()
    })

    it("recovers from a transient initialization failure", async () => {
        state.init.mockImplementationOnce(() => {
            throw new Error("temporary")
        })
        const {loadPostHog} = await import("@/features/analytics/client")
        expect(await loadPostHog()).not.toBeNull()
        expect(state.init).toHaveBeenCalledTimes(2)
    })

    it("resets an SDK load that was in flight during logout", async () => {
        const {loadPostHog, resetAnalytics} = await import("@/features/analytics/client")
        const loading = loadPostHog()
        await resetAnalytics()
        await loading
        expect(state.reset).toHaveBeenCalledTimes(1)
    })

    it("recognizes prefixed and unprefixed auth routes, except callbacks", async () => {
        const {isAnalyticsAuthRoute} = await import("@/features/analytics/client")
        expect(isAnalyticsAuthRoute("/m/auth?next=/w")).toBe(true)
        expect(isAnalyticsAuthRoute("/auth")).toBe(true)
        expect(isAnalyticsAuthRoute("/m/auth/callback/google")).toBe(false)
        expect(isAnalyticsAuthRoute("/m/w/ws/p/p/sessions/id")).toBe(false)
    })
})
