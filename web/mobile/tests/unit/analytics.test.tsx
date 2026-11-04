// @vitest-environment jsdom
import {act, StrictMode} from "react"

import {getDefaultStore} from "jotai"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

const state = vi.hoisted(() => ({
    key: "test-project-key",
    cloud: true,
    user: null as {
        id: string
        email: string
        username: string
        instance_id?: string
    } | null,
    path: "/w/ws/p/project/sessions/one",
    listeners: new Set<() => void>(),
    reporter: null as ((payload: Record<string, unknown>) => void) | null,
    distinctId: "anonymous",
    capture: vi.fn(),
    alias: vi.fn(),
    identify: vi.fn(),
    group: vi.fn(),
    optOut: vi.fn(),
    reset: vi.fn(),
    init: vi.fn(),
}))

vi.mock("@/lib/env", () => ({getEnv: () => state.key}))
vi.mock("@agenta/shared/api/env", () => ({isEE: () => state.cloud}))
vi.mock("@agenta/entities/profile", () => ({useProfile: () => ({user: state.user})}))
vi.mock("@agenta/entities/workflow/agentCreationTelemetry", () => ({
    setAgentCreationFailureReporter: (reporter: typeof state.reporter) => {
        state.reporter = reporter
    },
}))
vi.mock("next/router", () => {
    const events = {
        on: (_event: string, listener: () => void) => state.listeners.add(listener),
        off: (_event: string, listener: () => void) => state.listeners.delete(listener),
    }
    return {useRouter: () => ({asPath: state.path, pathname: state.path, events})}
})
vi.mock("posthog-js", () => ({
    default: {
        init: state.init,
        capture: state.capture,
        alias: state.alias,
        identify: state.identify,
        group: state.group,
        get_distinct_id: () => state.distinctId,
        opt_out_capturing: state.optOut,
        reset: state.reset,
    },
}))

import {Analytics} from "@/features/analytics/Analytics"
import {captureIntent, posthogAtom, resetAnalytics} from "@/features/analytics/client"
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT =
    true
let root: Root

const render = async () => {
    await act(async () =>
        root.render(
            <StrictMode>
                <Analytics />
            </StrictMode>,
        ),
    )
}

beforeEach(async () => {
    vi.clearAllMocks()
    state.identify.mockImplementation((id: string) => {
        state.distinctId = id
    })
    state.key = "test-project-key"
    state.cloud = true
    state.user = null
    state.distinctId = "anonymous"
    state.path = "/w/ws/p/project/sessions/one"
    state.listeners.clear()
    localStorage.clear()
    window.history.replaceState({}, "", `/m${state.path}`)
    vi.stubGlobal(
        "matchMedia",
        vi.fn(() => ({matches: true})),
    )
    state.init.mockImplementation((_key, config) => {
        config.loaded({
            capture: state.capture,
            alias: state.alias,
            identify: state.identify,
            group: state.group,
            get_distinct_id: () => state.distinctId,
            opt_out_capturing: state.optOut,
            reset: state.reset,
        })
    })
    getDefaultStore().set(posthogAtom, null)
    root = createRoot(document.createElement("div"))
})

afterEach(async () => {
    await act(async () => root.unmount())
    vi.unstubAllGlobals()
})

describe("mobile PostHog parity", () => {
    it("loads once in Strict Mode, uses desktop settings and captures the initial /m URL once", async () => {
        await render()
        expect(state.init).toHaveBeenCalledTimes(1)
        expect(state.init).toHaveBeenCalledWith(
            "test-project-key",
            expect.objectContaining({
                api_host: "https://alef.agenta.ai",
                ui_host: "https://us.posthog.com",
                capture_pageview: false,
                session_recording: {
                    maskAllInputs: false,
                    maskInputOptions: {password: true, email: true},
                },
            }),
        )
        // The browser stays anonymous until the profile loads.
        expect(state.identify).not.toHaveBeenCalled()
        expect(state.capture.mock.calls.filter(([event]) => event === "$pageview")).toEqual([
            ["$pageview", {$current_url: window.location.href}],
        ])
        expect(state.capture).toHaveBeenCalledWith("user_device_theme", {
            $set: {deviceTheme: "dark"},
        })
        expect(state.listeners.size).toBe(1)
    })

    it("identifies a hydrated profile by user id, with email as a property", async () => {
        await render()
        state.user = {id: "user-1", email: "test@agenta.ai", username: "test"}
        await render()
        expect(state.identify.mock.calls).toEqual([
            ["user-1", {email: "test@agenta.ai", username: "test"}],
        ])
        await render()
        expect(state.identify).toHaveBeenCalledTimes(1)
        state.user = {...state.user, username: "Renamed"}
        await render()
        expect(state.identify).toHaveBeenLastCalledWith("user-1", {
            email: "test@agenta.ai",
            username: "Renamed",
        })
        expect(state.alias).not.toHaveBeenCalled()
    })

    it("attaches the deployment as the instance group", async () => {
        state.user = {
            id: "user-1",
            email: "test@agenta.ai",
            username: "test",
            instance_id: "instance-1",
        }
        await render()
        expect(state.group).toHaveBeenCalledWith("instance", "instance-1")
    })

    it("identifies the same person again after an analytics reset", async () => {
        state.user = {id: "user-1", email: "test@agenta.ai", username: "test"}
        await render()
        state.distinctId = "anonymous-after-reset"
        state.user = {...state.user}
        await render()
        expect(state.identify).toHaveBeenCalledTimes(2)
    })

    it("identifies self-hosted users the same way, never by a device id", async () => {
        state.cloud = false
        await render()
        expect(state.identify).not.toHaveBeenCalled()
        state.user = {id: "user-1", email: "test@agenta.ai", username: "test"}
        await render()
        expect(state.identify.mock.calls).toEqual([
            ["user-1", {email: "test@agenta.ai", username: "test"}],
        ])
    })

    it("captures client navigation, but never the sign-in page, and removes listeners", async () => {
        await render()
        state.capture.mockClear()
        window.history.replaceState({}, "", "/m/w/ws/p/project/agents")
        state.listeners.forEach((listener) => listener())
        expect(state.capture).toHaveBeenCalledWith("$pageview", {
            $current_url: window.location.href,
        })
        window.history.replaceState({}, "", "/m/auth")
        state.listeners.forEach((listener) => listener())
        expect(state.capture).toHaveBeenCalledTimes(1)
        await act(async () => root.unmount())
        expect(state.listeners.size).toBe(0)
        expect(state.reporter).toBeNull()
        root = createRoot(document.createElement("div"))
    })

    it("does nothing without a project key or on an initial auth page", async () => {
        state.key = ""
        await render()
        expect(state.capture).not.toHaveBeenCalled()
        expect(state.init).not.toHaveBeenCalled()
        state.key = "test-project-key"
        state.path = "/auth"
        window.history.replaceState({}, "", "/m/auth")
        await render()
        expect(state.capture).not.toHaveBeenCalled()
        expect(state.init).not.toHaveBeenCalled()
        expect(state.reporter).toBeNull()
    })

    it("starts tracking after leaving auth and allows the callback route", async () => {
        state.path = "/auth"
        window.history.replaceState({}, "", "/m/auth")
        await render()
        state.path = "/auth/callback/google"
        window.history.replaceState({}, "", "/m/auth/callback/google")
        await render()
        expect(state.capture).toHaveBeenCalledWith("$pageview", {
            $current_url: window.location.href,
        })
    })

    it("reports creation failures and onboarding intent without the composer text", async () => {
        await render()
        state.reporter?.({reason: "no_project", type: "agent", elapsed_ms: 10})
        expect(state.capture).toHaveBeenCalledWith("agent_create_failed", {
            reason: "no_project",
            type: "agent",
            elapsed_ms: 10,
        })
        captureIntent({source: "composer", intentValue: "research"})
        expect(state.capture).toHaveBeenCalledWith("first_agent_intent", {
            source: "composer",
            $set: {first_agent_intent_v1: "research"},
        })
        await resetAnalytics()
        expect(state.reset).toHaveBeenCalledTimes(1)
    })

    it("does not mark the device theme captured when tracking is disabled", async () => {
        state.key = ""
        await render()
        expect(localStorage.getItem("hasCapturedTheme")).toBeNull()
    })

    it("does not emit the theme event a second time after desktop already captured it", async () => {
        localStorage.setItem("hasCapturedTheme", "true")
        await render()
        expect(state.capture.mock.calls.some(([event]) => event === "user_device_theme")).toBe(
            false,
        )
    })
})
