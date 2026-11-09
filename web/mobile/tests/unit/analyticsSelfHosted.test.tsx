// @vitest-environment jsdom
import {act} from "react"

import {QueryClient, QueryClientProvider} from "@tanstack/react-query"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

// Its own file: `loadPostHog` loads once per page, so a cloud load in another test
// would hide the self-hosted settings.
const state = vi.hoisted(() => ({
    capture: vi.fn(),
    alias: vi.fn(),
    identify: vi.fn(),
    group: vi.fn(),
    reset: vi.fn(),
    init: vi.fn(),
}))

vi.mock("@/lib/env", () => ({getEnv: () => "test-project-key"}))
vi.mock("@agenta/shared/api", () => ({
    axios: {
        get: async () => ({
            data: {
                enabled: true,
                distinct_id: "instance-1:user-1",
                groups: {instance: "instance-1"},
            },
        }),
    },
    getAgentaApiUrl: () => "https://agenta.example.test/api",
}))
vi.mock("@agenta/entities/profile", () => ({
    useProfile: () => ({
        user: {id: "user-1", email: "person@example.test", username: "Person"},
    }),
}))
vi.mock("@agenta/entities/workflow/agentCreationTelemetry", () => ({
    setAgentCreationFailureReporter: () => undefined,
}))
vi.mock("next/router", () => ({
    useRouter: () => ({
        asPath: "/w/ws/p/project/sessions/one",
        pathname: "/w/ws/p/project/sessions/one",
        events: {on: () => undefined, off: () => undefined},
    }),
}))
vi.mock("posthog-js", () => ({default: {init: state.init}}))

import {Analytics} from "@/features/analytics/Analytics"
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT =
    true
let root: Root

beforeEach(async () => {
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
            reset: state.reset,
            // An id stored before the upgrade, such as the email.
            get_distinct_id: () => "person@example.test",
            opt_out_capturing: vi.fn(),
        })
    })
    root = createRoot(document.createElement("div"))
    await act(async () =>
        root.render(
            <QueryClientProvider client={new QueryClient()}>
                <Analytics />
            </QueryClientProvider>,
        ),
    )
    for (let tick = 0; tick < 3; tick++) {
        await act(async () => new Promise((resolve) => setTimeout(resolve, 0)))
    }
})

afterEach(async () => {
    await act(async () => root.unmount())
    vi.unstubAllGlobals()
})

describe("self-hosted PostHog", () => {
    it("uses the API's anonymous id, the instance group, and no recording", () => {
        const config = state.init.mock.calls[0][1]
        expect(config).toMatchObject({
            persistence: "localStorage+cookie",
            autocapture: false,
            disable_session_recording: true,
        })
        expect(config).not.toHaveProperty("session_recording")
        expect(state.reset).toHaveBeenCalledTimes(1)
        expect(state.reset.mock.invocationCallOrder[0]).toBeLessThan(
            state.identify.mock.invocationCallOrder[0],
        )
        expect(state.identify.mock.calls).toEqual([["instance-1:user-1", undefined]])
        expect(state.group).toHaveBeenCalledWith("instance", "instance-1")
        expect(state.alias).not.toHaveBeenCalled()
        const sent = JSON.stringify([state.identify.mock.calls, state.capture.mock.calls])
        expect(sent).not.toContain("person@example.test")
        expect(sent).not.toContain("Person")
    })

    it("strips the instance address from every event", () => {
        const {before_send: beforeSend} = state.init.mock.calls[0][1]
        const sent = beforeSend({
            uuid: "e1",
            event: "$pageview",
            properties: {
                $current_url: "https://agenta.internal.example/m/w",
                $host: "agenta.internal.example",
                $pathname: "/m/w",
            },
            $set_once: {$initial_current_url: "https://agenta.internal.example/m"},
        })
        expect(JSON.stringify(sent)).not.toContain("agenta.internal.example")
        expect(sent.properties).toEqual({$pathname: "/m/w", $geoip_disable: true})
    })
})
