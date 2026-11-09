// @vitest-environment jsdom
import {act, StrictMode} from "react"

import {QueryClient, QueryClientProvider} from "@tanstack/react-query"
import {getDefaultStore} from "jotai"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

const state = vi.hoisted(() => ({
    key: "test-project-key",
    telemetry: null as Record<string, unknown> | null,
    user: null as {id: string; email: string; username: string} | null,
    path: "/w/ws/p/project/sessions/one",
    listeners: new Set<() => void>(),
    reporter: null as ((payload: Record<string, unknown>) => void) | null,
    distinctId: "anonymous",
    capture: vi.fn(),
    alias: vi.fn(),
    identify: vi.fn(),
    group: vi.fn(),
    optOut: vi.fn(),
    get: vi.fn(),
    reset: vi.fn(),
    init: vi.fn(),
}))

vi.mock("@/lib/env", () => ({getEnv: () => state.key}))
vi.mock("@agenta/shared/api", () => ({
    axios: {get: state.get},
    getAgentaApiUrl: () => "https://agenta.example.test/api",
}))
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
let queryClient: QueryClient

const CLOUD_USER = {id: "user-1", email: "person@example.test", username: "Person"}
const cloudTelemetry = (email = CLOUD_USER.email) => ({
    enabled: true,
    distinct_id: email,
    groups: null,
})

const render = async () => {
    await act(async () =>
        root.render(
            <QueryClientProvider client={queryClient}>
                <StrictMode>
                    <Analytics />
                </StrictMode>
            </QueryClientProvider>,
        ),
    )
    // Let the telemetry request settle and the effects that follow it run.
    for (let tick = 0; tick < 3; tick++) {
        await act(async () => new Promise((resolve) => setTimeout(resolve, 0)))
    }
}

beforeEach(async () => {
    vi.clearAllMocks()
    state.key = "test-project-key"
    state.user = CLOUD_USER
    state.telemetry = cloudTelemetry()
    state.get.mockImplementation(async () => ({data: state.telemetry}))
    queryClient = new QueryClient({defaultOptions: {queries: {retry: false}}})
    state.distinctId = "anonymous"
    state.path = "/w/ws/p/project/sessions/one"
    state.listeners.clear()
    localStorage.clear()
    localStorage.setItem("posthog_distinct_id", "desktop-visitor")
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
        expect(state.identify).toHaveBeenCalledWith("desktop-visitor")
        expect(state.capture.mock.calls.filter(([event]) => event === "$pageview")).toEqual([
            ["$pageview", {$current_url: window.location.href}],
        ])
        expect(state.capture).toHaveBeenCalledWith("user_device_theme", {
            $set: {deviceTheme: "dark"},
        })
        expect(state.listeners.size).toBe(1)
    })

    it("waits for a signed-in user before it loads", async () => {
        state.user = null
        await render()
        expect(state.get).not.toHaveBeenCalled()
        expect(state.init).not.toHaveBeenCalled()
    })

    it("identifies a cloud profile by email and keeps desktop identity and properties", async () => {
        await render()
        expect(state.get).toHaveBeenCalledWith("https://agenta.example.test/api/instance/telemetry")
        expect(state.alias).toHaveBeenCalledWith("person@example.test", "desktop-visitor")
        expect(state.identify).toHaveBeenLastCalledWith("person@example.test", {
            email: CLOUD_USER.email,
            username: CLOUD_USER.username,
        })
        expect(state.group).not.toHaveBeenCalled()
        const count = state.identify.mock.calls.length
        await render()
        expect(state.identify).toHaveBeenCalledTimes(count)
        state.user = {...CLOUD_USER, username: "Renamed"}
        await render()
        expect(state.alias).toHaveBeenCalledTimes(1)
        expect(state.identify).toHaveBeenLastCalledWith("person@example.test", {
            email: CLOUD_USER.email,
            username: "Renamed",
        })
    })

    it("loads nothing and sends nothing when the instance turned telemetry off", async () => {
        state.telemetry = {enabled: false, distinct_id: null, groups: null}
        await render()
        expect(state.init).not.toHaveBeenCalled()
        expect(state.capture).not.toHaveBeenCalled()
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
