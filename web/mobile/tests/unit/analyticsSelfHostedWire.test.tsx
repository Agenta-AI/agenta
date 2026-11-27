// @vitest-environment jsdom
import {act} from "react"

import {gunzipSync} from "node:zlib"

import {QueryClient, QueryClientProvider} from "@tanstack/react-query"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

// The real posthog-js, with only the network replaced: checks that a self-hosted browser
// really sends its events, which the mocked client in the other analytics tests cannot.
const KEY = "test-project-key"

vi.mock("@/lib/env", () => ({getEnv: () => KEY}))
vi.mock("@agenta/shared/api", () => ({
    axios: {
        get: async () => ({
            data: {
                enabled: true,
                distinct_id: "instance-1:user-1",
                groups: {instance: "instance-1"},
                properties: {instance_kind: "test"},
            },
        }),
    },
    getAgentaApiUrl: () => "https://agenta.example.test/api",
}))
vi.mock("@agenta/entities/profile", () => ({
    useProfile: () => ({user: {id: "user-1", email: "person@example.test"}}),
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

import {Analytics} from "@/features/analytics/Analytics"
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT =
    true

interface SentEvent {
    event: string
    properties: Record<string, unknown>
}

const sent: {url: string; body: unknown}[] = []
let root: Root

/** The events in the requests to the PostHog proxy. posthog-js gzips the body. */
const sentEvents = async () => {
    const events: SentEvent[] = []
    for (const {url, body} of sent) {
        if (!url.startsWith("https://alef.agenta.ai/e/")) continue
        const bytes = Buffer.from(await new Response(body as BodyInit).arrayBuffer())
        const text = url.includes("compression=gzip-js")
            ? gunzipSync(bytes).toString()
            : bytes.toString()
        const parsed = JSON.parse(text)
        events.push(...(Array.isArray(parsed) ? parsed : [parsed]))
    }
    return events
}

beforeEach(async () => {
    vi.stubGlobal(
        "matchMedia",
        vi.fn(() => ({matches: true})),
    )
    vi.stubGlobal(
        "fetch",
        vi.fn(async (url: string, init?: {body?: unknown}) => {
            sent.push({url: String(url), body: init?.body})
            return new Response("{}", {status: 200})
        }),
    )
    // An opt-out stored while telemetry was off must not keep the browser silent.
    localStorage.setItem(`__ph_opt_in_out_${KEY}`, "0")
    const container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => {
        root.render(
            <QueryClientProvider client={new QueryClient()}>
                <Analytics />
            </QueryClientProvider>,
        )
    })
})

afterEach(() => {
    act(() => root.unmount())
    vi.unstubAllGlobals()
})

describe("self-hosted analytics on the wire", () => {
    it("sends the identify and the page view to the project, after a stored opt-out", async () => {
        await vi.waitFor(
            async () => {
                const events = (await sentEvents()).map((event) => event.event)
                expect(events).toContain("$identify")
                expect(events).toContain("$pageview")
            },
            {timeout: 10_000, interval: 100},
        )
        const events = await sentEvents()
        const pageview = events.find((event) => event.event === "$pageview")
        expect(pageview?.properties.distinct_id).toBe("instance-1:user-1")
        expect(pageview?.properties.instance_kind).toBe("test")
        expect(pageview?.properties.$current_url).toBeUndefined()
        expect(JSON.stringify(events)).not.toContain("person@example.test")
    }, 15_000)
})
