// @vitest-environment jsdom
import {act, createElement} from "react"

import {projectIdAtom, sessionAtom} from "@agenta/shared/state"
import {QueryClient, QueryClientProvider} from "@tanstack/react-query"
import {createStore, Provider} from "jotai"
import {queryClientAtom} from "jotai-tanstack-query"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

import {AppUsageSection} from "@/features/app-overview/AppUsageSection"

// The real dashboard query, range atom and permission check run; only `fetch` is replaced.
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT =
    true

const COST = "attributes.ag.metrics.costs.cumulative.total"
const TOKENS = "attributes.ag.metrics.tokens.cumulative.total"
const DURATION = "attributes.ag.metrics.duration.cumulative"
const ERRORS = "attributes.ag.metrics.errors.cumulative"
const TRACES = "attributes.ag.type.trace"

/** Two days of traffic: 51 traces, 3 failed, one without a cost. */
const BUSY_BUCKETS = [
    {
        timestamp: "2026-10-08T12:00:00Z",
        metrics: {
            [TRACES]: {count: 30},
            [COST]: {sum: 0.0003, count: 30},
            [TOKENS]: {sum: 1500},
            [DURATION]: {sum: 15000, count: 30},
        },
    },
    {
        timestamp: "2026-11-05T12:00:00Z",
        metrics: {
            [TRACES]: {count: 21},
            [ERRORS]: {count: 3},
            [COST]: {sum: 0.0002, count: 20},
            [TOKENS]: {sum: 1172},
            [DURATION]: {sum: 12000, count: 21},
        },
    },
]

let buckets: unknown[] = []
let analyticsFails = false
const analyticsRequests: URL[] = []

const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {status, headers: {"content-type": "application/json"}})

let host: HTMLDivElement
let root: Root
let store: ReturnType<typeof createStore>

const settle = async () => {
    for (let turn = 0; turn < 6; turn++) {
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 10))
        })
    }
}

const mount = async () => {
    const client = new QueryClient({defaultOptions: {queries: {retry: false}}})
    store = createStore()
    store.set(queryClientAtom, client)
    store.set(projectIdAtom, "project-1")
    store.set(sessionAtom, true)
    await act(async () =>
        root.render(
            createElement(
                Provider,
                {store},
                createElement(
                    QueryClientProvider,
                    {client},
                    createElement(AppUsageSection, {appId: "app-1"}),
                ),
            ),
        ),
    )
    await settle()
}

const card = (title: string) => host.querySelector(`section[aria-label="${title}"]`)
const cardText = (title: string) => card(title)?.textContent ?? ""
/** The hidden data table each chart carries, row by row. */
const chartRows = (title: string) =>
    [...(card(title)?.querySelectorAll("tbody tr") ?? [])].map((row) =>
        [...row.children].map((cell) => cell.textContent),
    )

beforeEach(() => {
    host = document.createElement("div")
    document.body.appendChild(host)
    root = createRoot(host)
    buckets = BUSY_BUCKETS
    analyticsFails = false
    analyticsRequests.length = 0
    vi.stubGlobal("fetch", async (input: string | URL | Request) => {
        const url = new URL(typeof input === "string" ? input : String(input), "https://api.test")
        if (url.pathname.endsWith("/access/permissions/check")) return json({})
        if (url.pathname.endsWith("/spans/analytics/query")) {
            analyticsRequests.push(url)
            if (analyticsFails) return json({detail: "statement timeout"}, 504)
            return json({count: buckets.length, buckets})
        }
        return json({detail: "not found"}, 404)
    })
})

afterEach(() => {
    act(() => root.unmount())
    host.remove()
    vi.unstubAllGlobals()
})

const daysAgo = (iso: string | null) => (Date.now() - Date.parse(iso ?? "")) / 86_400_000

describe("app usage charts", () => {
    it("The four cards show this app's totals for the last month", async () => {
        await mount()
        const request = analyticsRequests.at(-1)
        if (!request) throw new Error("no usage request")
        expect(JSON.parse(request.searchParams.get("filter") ?? "null")).toEqual({
            conditions: [{field: "references", operator: "in", value: [{id: "app-1"}]}],
        })
        expect(daysAgo(request.searchParams.get("oldest"))).toBeGreaterThan(27)
        expect(daysAgo(request.searchParams.get("oldest"))).toBeLessThan(32)

        expect(host.querySelector('button[aria-label="Usage date range"]')?.textContent).toBe(
            "Last 1 month",
        )
        expect(cardText("Requests")).toContain("Total:51")
        expect(cardText("Requests")).toContain("Failed:5.88%")
        expect(cardText("Latency")).toContain("Avg:529.41ms")
        expect(cardText("Cost")).toContain("Total:$0.0005")
        expect(cardText("Cost")).toContain("Avg:$0.00001")
        expect(cardText("Cost")).toContain("Without cost:1")
        expect(cardText("Tokens")).toContain("Total:2,672")
        expect(cardText("Tokens")).toContain("Avg:52.39")
    })

    it("Each chart plots one point per day, with failed requests as their own line", async () => {
        await mount()
        expect(chartRows("Requests")).toEqual([
            ["8 Oct", "30", "0"],
            ["5 Nov", "18", "3"],
        ])
        expect(chartRows("Latency")).toEqual([
            ["8 Oct", "500ms"],
            ["5 Nov", "571.4ms"],
        ])
        expect(chartRows("Tokens")).toEqual([
            ["8 Oct", "1.5K"],
            ["5 Nov", "1.2K"],
        ])
    })

    it("Requests have one line and no failure rate when nothing failed", async () => {
        buckets = [BUSY_BUCKETS[0]]
        await mount()
        expect(cardText("Requests")).not.toContain("Failed")
        expect(chartRows("Requests")).toEqual([["8 Oct", "30"]])
    })

    it("A window without traces shows No data in every card", async () => {
        buckets = []
        await mount()
        for (const title of ["Requests", "Latency", "Cost", "Tokens"]) {
            expect(cardText(title)).toContain("No data")
            expect(chartRows(title)).toEqual([])
        }
        expect(cardText("Requests")).toContain("Total:-")
    })

    it("A failed request shows the reason once and no No data", async () => {
        analyticsFails = true
        await mount()
        expect(host.querySelectorAll('[role="alert"]')).toHaveLength(1)
        expect(host.textContent).not.toContain("No data")
    })

    it("Picking Last 7 days asks for that window again", async () => {
        await mount()
        const trigger = host.querySelector<HTMLButtonElement>(
            'button[aria-label="Usage date range"]',
        )
        await act(async () => trigger?.click())
        const option = [
            ...document.querySelectorAll<HTMLButtonElement>("[role=menuitemradio]"),
        ].find((item) => item.textContent === "7 days")
        expect(option).toBeDefined()
        const before = analyticsRequests.length
        await act(async () => option?.click())
        await settle()
        expect(analyticsRequests.length).toBeGreaterThan(before)
        const oldest = analyticsRequests.at(-1)?.searchParams.get("oldest") ?? null
        expect(daysAgo(oldest)).toBeGreaterThan(6.9)
        expect(daysAgo(oldest)).toBeLessThan(7.1)
        expect(trigger?.textContent).toBe("Last 7 days")
    })
})
