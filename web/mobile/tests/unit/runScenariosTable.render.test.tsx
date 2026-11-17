// @vitest-environment jsdom
import {act, createElement} from "react"

import type {RunHeader} from "@agenta/entities/evaluationRun"
import {projectIdAtom, sessionAtom} from "@agenta/shared/state"
import {QueryClient, QueryClientProvider} from "@tanstack/react-query"
import {getDefaultStore, Provider} from "jotai"
import {queryClientAtom} from "jotai-tanstack-query"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

const http = vi.hoisted(() => ({
    post: vi.fn(),
    patch: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
    get: vi.fn(),
}))
vi.mock("@agenta/shared/api", async (original) => ({
    ...(await original<typeof import("@agenta/shared/api")>()),
    axios: http,
    getAgentaApiUrl: () => "https://agenta.test/api",
}))

const router = vi.hoisted(() => ({
    query: {} as Record<string, string>,
    replace: vi.fn(),
}))
vi.mock("next/router", () => ({
    useRouter: () => ({
        query: router.query,
        pathname: "/w/[workspace_id]/p/[project_id]/evaluations/results/[evaluation_id]",
        replace: router.replace,
    }),
}))

import {ScenariosTab} from "@/features/evaluation-run/scenarios/ScenariosTab"

import {answerRequest, newServerState, type ScenarioServerState} from "./runScenariosFixtures"

const RUN: RunHeader = {
    name: "Capitals check",
    description: null,
    status: "evaluation_finished",
    kind: "auto",
    flags: {isLive: false, isClosed: false, isActive: false},
    createdAt: null,
    updatedAt: null,
    createdById: null,
}
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT =
    true

const store = getDefaultStore()
let host: HTMLDivElement
let root: Root
let counter = 0
let state: ScenarioServerState

const settle = (ms = 1000) =>
    act(async () => {
        await vi.advanceTimersByTimeAsync(ms)
    })

async function mount(patch: Partial<ScenarioServerState> = {}, header: RunHeader = RUN) {
    const runId = `table-run-${++counter}`
    state = newServerState({appMetrics: true, ...patch})
    window.matchMedia = ((query: string) => ({
        matches: true,
        media: query,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
    })) as unknown as typeof window.matchMedia
    http.post.mockImplementation(async (url: string, body: Record<string, unknown>) =>
        answerRequest(runId, state, url, body),
    )
    const client = new QueryClient({defaultOptions: {queries: {retry: false}}})
    store.set(queryClientAtom, client)
    router.query = {workspace_id: "ws", project_id: "pr", evaluation_id: runId}
    await act(async () => {
        root.render(
            createElement(
                Provider,
                {store},
                createElement(
                    QueryClientProvider,
                    {client},
                    createElement(ScenariosTab, {runId, header}),
                ),
            ),
        )
    })
    await settle()
    await settle()
    return runId
}

const headers = () =>
    [...host.querySelectorAll('[role="columnheader"]')].map((node) => node.textContent)
const rows = () => [...host.querySelectorAll('[role="button"]')]
const rowCountries = () =>
    rows().map((row) =>
        ["France", "Japan", "Chile", "Kenya", "Peru", "Norway"].find((name) =>
            row.textContent?.includes(name),
        ),
    )
const button = (name: string) =>
    [...document.querySelectorAll("button")].find(
        (node) => node.getAttribute("aria-label") === name || node.textContent?.trim() === name,
    ) as HTMLButtonElement | undefined
const scenarioReads = () =>
    state.calls.filter((call) => call.url.endsWith("/evaluations/scenarios/query")).length

const click = (node: Element | undefined) =>
    act(async () => {
        ;(node as HTMLElement | undefined)?.click()
        await vi.advanceTimersByTimeAsync(50)
    })

/** Open a Radix select by its label and pick an option by its text. */
async function pick(label: string, option: string) {
    const trigger = button(label)
    expect(trigger, `select ${label}`).toBeDefined()
    await act(async () => {
        trigger?.focus()
        trigger?.dispatchEvent(
            new KeyboardEvent("keydown", {key: "Enter", bubbles: true, cancelable: true}),
        )
        await vi.advanceTimersByTimeAsync(50)
    })
    const item = [...document.querySelectorAll<HTMLElement>("[role='option']")].find(
        (node) => node.textContent?.trim() === option,
    )
    expect(item, `option ${option}`).toBeDefined()
    await act(async () => {
        item?.focus()
        item?.dispatchEvent(
            new KeyboardEvent("keydown", {key: "Enter", bubbles: true, cancelable: true}),
        )
        await vi.advanceTimersByTimeAsync(50)
    })
}

/** Filter the table on the evaluator's success output. */
async function filterOnSuccess(value: "true" | "false") {
    await click(button("Filter scenarios"))
    await pick("Column of condition 1", "Exact Match · success")
    await pick("Value", value)
    await click(button("Apply"))
    await settle()
    await settle()
}

beforeEach(() => {
    vi.useFakeTimers()
    // Radix Select measures and scrolls on open; jsdom has neither.
    Element.prototype.scrollIntoView = vi.fn()
    Element.prototype.hasPointerCapture = vi.fn(() => false)
    Element.prototype.releasePointerCapture = vi.fn()
    host = document.createElement("div")
    document.body.appendChild(host)
    root = createRoot(host)
    store.set(projectIdAtom, "pr")
    store.set(sessionAtom, true)
    Object.values(http).forEach((fn) => fn.mockReset())
    router.replace.mockReset()
    vi.stubGlobal(
        "IntersectionObserver",
        class {
            observe = vi.fn()
            disconnect = vi.fn()
        },
    )
})

afterEach(() => {
    act(() => root.unmount())
    host.remove()
    vi.useRealTimers()
    vi.unstubAllGlobals()
})

describe("scenarios table", () => {
    it("Each row shows the cost, duration, tokens and errors of its app call", async () => {
        await mount({ids: ["sc-1"]})
        expect(headers().slice(-4)).toEqual(["Cost", "Duration", "Tokens", "Errors"])
        const text = rows()[0].textContent ?? ""
        expect(text).toContain("$0.000012")
        expect(text).toContain("522ms")
        expect(text).toContain("128")
    })

    it("A scenario without app metrics shows a dash in the metric columns", async () => {
        await mount({ids: ["sc-1"], appMetrics: false})
        const cells = [...rows()[0].children].slice(-4).map((cell) => cell.textContent)
        expect(cells).toEqual(["—", "—", "—", "—"])
    })

    it("Filtering on success equals false shows only the failed scenarios, Clear shows all", async () => {
        await mount({ids: ["sc-1", "sc-2", "sc-3"], failing: ["sc-2"]})
        await filterOnSuccess("false")
        expect(rowCountries()).toEqual(["Japan"])
        // The row keeps its place number in the run.
        expect(rows()[0].textContent).toContain("2")
        expect(button("Filter scenarios")?.textContent).toContain("Filter (1)")

        await click(button("Filter scenarios"))
        expect(document.body.textContent).toContain("1 match")
        await click(button("Clear"))
        await settle()
        expect(rowCountries()).toEqual(["France", "Japan", "Chile"])
    })

    it("A filter left without a value is not applied", async () => {
        await mount({ids: ["sc-1", "sc-2"], failing: ["sc-2"]})
        await click(button("Filter scenarios"))
        await pick("Column of condition 1", "Exact Match · success")
        await click(button("Apply"))
        await settle()
        expect(rowCountries()).toEqual(["France", "Japan"])
        expect(button("Filter scenarios")?.textContent).toBe("Filter")
    })

    it("A filter with few matches reads the next pages until it finds them", async () => {
        const ids = ["sc-1", "sc-2", "sc-3", "sc-4", "sc-5", "sc-6"]
        await mount({ids, pageSize: 2, failing: ["sc-5"]})
        expect(scenarioReads()).toBe(1)
        await filterOnSuccess("false")
        await settle()
        await settle()
        expect(rowCountries()).toEqual(["Peru"])
        // Three pages of two: every page was read to look for matches.
        expect(scenarioReads()).toBe(3)
    })

    it("A filter that matches nothing says so and offers to clear it", async () => {
        await mount({ids: ["sc-1", "sc-2"]})
        await filterOnSuccess("false")
        expect(host.textContent).toContain("No scenarios match this filter")
        await click(button("Clear filter"))
        await settle()
        expect(rowCountries()).toEqual(["France", "Japan"])
    })

    it("Hiding columns in the settings removes them from the table", async () => {
        await mount({ids: ["sc-1"]})
        await click(button("Columns"))
        await click(document.querySelector('[aria-label="Metrics: Cost"]') ?? undefined)
        expect(headers()).not.toContain("Cost")
        expect(headers()).toContain("Duration")

        // The group box hides the rest of the group, then shows all of it again.
        const metrics = [...document.querySelectorAll("label")].find(
            (node) => node.textContent === "Metrics",
        )
        await click(metrics?.querySelector("button") ?? undefined)
        expect(headers()).toContain("Cost")
        await click(metrics?.querySelector("button") ?? undefined)
        expect(headers().slice(-1)).toEqual(["Exact Match · success"])

        await click(button("Show all"))
        expect(headers().slice(-4)).toEqual(["Cost", "Duration", "Tokens", "Errors"])
    })

    it("On a human run each row has Annotate next to its status", async () => {
        await mount({ids: ["sc-1", "sc-2"]}, {...RUN, kind: "human"})
        expect(headers().slice(0, 3)).toEqual(["#", "Status", "Actions"])
        const annotate = rows().map((row) =>
            [...row.querySelectorAll("button")].some((node) => node.textContent === "Annotate"),
        )
        expect(annotate).toEqual([true, true])
    })
})
