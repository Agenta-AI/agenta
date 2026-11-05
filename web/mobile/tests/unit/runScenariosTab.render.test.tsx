// @vitest-environment jsdom
import {act, createElement} from "react"

import type {RunHeader} from "@agenta/entities/evaluationRun"
import {primeWorkflowArtifactCacheImperative} from "@agenta/entities/workflow"
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

/** The scenarios tab only needs the run kind: an automatic run has no Annotate action. */
const AUTO_RUN: RunHeader = {
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
let client: QueryClient
let intersect: (() => void) | null = null

const settle = (ms = 1000) =>
    act(async () => {
        await vi.advanceTimersByTimeAsync(ms)
    })

function stubWidth(wide: boolean) {
    window.matchMedia = ((query: string) => ({
        matches: wide,
        media: query,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
    })) as unknown as typeof window.matchMedia
}

async function mount(
    patch: Partial<ScenarioServerState> = {},
    wide = true,
    answer: typeof answerRequest = answerRequest,
) {
    const runId = `run-${++counter}`
    state = newServerState(patch)
    stubWidth(wide)
    http.post.mockImplementation(async (url: string, body: Record<string, unknown>) =>
        answer(runId, state, url, body),
    )
    client = new QueryClient({defaultOptions: {queries: {retry: false}}})
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
                    createElement(ScenariosTab, {runId, header: AUTO_RUN}),
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
const buttonNamed = (name: string) =>
    [...host.querySelectorAll("button")].find((button) => button.textContent?.trim() === name)

beforeEach(() => {
    vi.useFakeTimers()
    host = document.createElement("div")
    document.body.appendChild(host)
    root = createRoot(host)
    store.set(projectIdAtom, "pr")
    store.set(sessionAtom, true)
    Object.values(http).forEach((fn) => fn.mockReset())
    router.replace.mockReset()
    intersect = null
    vi.stubGlobal(
        "IntersectionObserver",
        class {
            constructor(callback: IntersectionObserverCallback) {
                intersect = () =>
                    callback([{isIntersecting: true} as IntersectionObserverEntry], this as never)
            }
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

describe("scenarios tab", () => {
    it("Each row shows its index, status and one column group per run step", async () => {
        await mount()
        expect(headers()).toEqual(["#", "Status", "Test set capitals", "Exact Match"])
        const rows = host.querySelectorAll('[role="button"]')
        expect(rows).toHaveLength(3)
        expect(rows[0].textContent).toContain("1")
        expect(rows[0].textContent).toContain("Success")
        expect(rows[0].textContent).toContain("France")
        expect(rows[2].textContent).toContain("Chile")
        // An automatic run has nothing to annotate by hand.
        expect([...host.querySelectorAll("button")].map((b) => b.textContent)).not.toContain(
            "Annotate",
        )
    })

    it("Group headers use the test set and evaluator names", async () => {
        client = new QueryClient({defaultOptions: {queries: {retry: false}}})
        await mount()
        client.setQueryData(["testset", "pr", "ts-1"], {id: "ts-1", name: "World capitals"})
        primeWorkflowArtifactCacheImperative([{id: "ev-1", name: "Capital match"}] as never)
        await settle()
        await settle()
        expect(headers().slice(2)).toEqual(["World capitals", "Capital match"])
    })

    it("A missing value shows a dash", async () => {
        // The evaluator has not scored the scenario yet: no metric row.
        await mount({ids: ["sc-1"], statuses: {"sc-1": "pending"}, scored: false})
        const row = host.querySelector('[role="button"]')
        expect(row?.textContent).toContain("Pending")
        expect(row?.textContent).toContain("France")
        expect(row?.textContent).toContain("—")
    })

    it("An evaluator that failed shows its error in its column and on the phone card", async () => {
        const failed: typeof answerRequest = (runId, serverState, url, body) => {
            const answer = answerRequest(runId, serverState, url, body)
            if (url.endsWith("/evaluations/results/query")) {
                const results = answer.data?.results ?? []
                for (const result of [...results]) {
                    results.push({
                        ...result,
                        step_key: "ev",
                        status: "failure",
                        error: {message: "Invalid regex pattern"},
                    } as never)
                }
            }
            return answer
        }
        const patch = {ids: ["sc-1"], statuses: {"sc-1": "errors"}, scored: false}
        await mount(patch, true, failed)
        expect(host.querySelector('[role="button"] [role="alert"]')?.textContent).toBe(
            "Invalid regex pattern",
        )
        act(() => root.unmount())
        root = createRoot(host)
        await mount(patch, false, failed)
        // The card names the evaluator, so two failed evaluators can be told apart.
        expect(host.querySelector('[role="alert"]')?.textContent).toBe(
            "Exact Match: Invalid regex pattern",
        )
    })

    it("A failed evaluator's error shows even when the scenario's traces did not load", async () => {
        const failed: typeof answerRequest = (runId, serverState, url, body) => {
            const answer = answerRequest(runId, serverState, url, body)
            if (url.endsWith("/evaluations/results/query")) {
                const results = answer.data?.results ?? []
                for (const result of [...results]) {
                    results.push({
                        ...result,
                        step_key: "ev",
                        status: "failure",
                        error: {message: "Invalid regex pattern"},
                    } as never)
                }
            }
            return answer
        }
        vi.stubGlobal(
            "fetch",
            vi.fn(async () => new Response("{}", {status: 400})),
        )
        await mount({ids: ["sc-1"], scored: false, failTraces: true}, true, failed)
        // The step's own error is known without its trace, so it takes the retry's place.
        const row = host.querySelector('[role="button"]')
        expect(row?.textContent).toContain("Invalid regex pattern")
    })

    it("Clicking a row writes focusScenarioId and focusRunId to the URL", async () => {
        const runId = await mount()
        const row = host.querySelectorAll('[role="button"]')[1] as HTMLElement
        await act(async () => row.click())
        expect(router.replace).toHaveBeenCalledWith(
            {
                pathname: "/w/[workspace_id]/p/[project_id]/evaluations/results/[evaluation_id]",
                query: {...router.query, focusScenarioId: "sc-2", focusRunId: runId},
            },
            undefined,
            {shallow: true},
        )
    })

    it("Reaching the end loads the next page", async () => {
        await mount({ids: ["sc-1", "sc-2", "sc-3", "sc-4"], pageSize: 3})
        expect(host.querySelectorAll('[role="button"]')).toHaveLength(3)
        await act(async () => intersect?.())
        await settle()
        expect(host.querySelectorAll('[role="button"]')).toHaveLength(4)
        expect(buttonNamed("Load more")).toBeUndefined()
    })

    it("The Load more button loads the next page too", async () => {
        await mount({ids: ["sc-1", "sc-2", "sc-3", "sc-4"], pageSize: 3})
        await act(async () => buttonNamed("Load more")?.click())
        await settle()
        expect(host.querySelectorAll('[role="button"]')).toHaveLength(4)
    })

    it("A run without scenarios shows No scenarios", async () => {
        await mount({ids: []})
        expect(host.textContent).toContain("No scenarios")
    })

    it("A scenarios load error shows a retry", async () => {
        await mount({failScenarios: true})
        expect(host.textContent).toContain("Could not load scenarios")
        state.failScenarios = false
        await act(async () => buttonNamed("Try again")?.click())
        await settle()
        expect(host.textContent).not.toContain("Could not load scenarios")
        expect(host.querySelectorAll('[role="button"]')).toHaveLength(3)
    })

    it("A failed next page keeps the rows and offers a retry", async () => {
        await mount({ids: ["sc-1", "sc-2", "sc-3", "sc-4"], pageSize: 3})
        state.failScenarios = true
        await act(async () => buttonNamed("Load more")?.click())
        await settle()
        expect(host.textContent).toContain("Could not load more scenarios")
        expect(host.querySelectorAll('[role="button"]')).toHaveLength(3)
        state.failScenarios = false
        await act(async () => buttonNamed("Try again")?.click())
        await settle()
        expect(host.querySelectorAll('[role="button"]')).toHaveLength(4)
    })

    it("A phone shows one card per scenario with its scores", async () => {
        await mount({}, false)
        expect(host.querySelectorAll('[role="columnheader"]')).toHaveLength(0)
        const cards = host.querySelectorAll('[role="button"]')
        expect(cards).toHaveLength(3)
        expect(cards[0].textContent).toContain("#1")
        expect(cards[0].textContent).toContain("France")
        expect(cards[0].textContent).toContain("Exact Match: true")
    })

    it("A row whose traces did not load says so and a retry loads it", async () => {
        vi.stubGlobal(
            "fetch",
            vi.fn(async () => new Response("{}", {status: 400})),
        )
        await mount({failTraces: true, ids: ["sc-1"]})
        const row = host.querySelector('[role="button"]')
        expect(row?.textContent).toContain("France")
        expect(row?.textContent).toContain("Could not load these values")
        vi.stubGlobal(
            "fetch",
            vi.fn(async () => new Response(JSON.stringify({count: 0, traces: []}), {status: 200})),
        )
        await act(async () => buttonNamed("Try again")?.click())
        await settle()
        expect(host.textContent).not.toContain("Could not load these values")
        expect(router.replace).not.toHaveBeenCalled()
    })

    it("A phone card of a row whose traces did not load shows the same retry", async () => {
        vi.stubGlobal(
            "fetch",
            vi.fn(async () => new Response("{}", {status: 400})),
        )
        await mount({failTraces: true, ids: ["sc-1"]}, false)
        expect(host.textContent).toContain("Could not load these values")
        expect(buttonNamed("Try again")).toBeDefined()
    })

    it("A failed last refresh after the run finishes shows an inline retry", async () => {
        await mount({runStatus: "running", statuses: {"sc-2": "running"}})
        state.statuses = {}
        state.runStatus = "evaluation_finished"
        state.failScenarios = true
        await settle(5000)
        await settle(500)
        expect(host.textContent).toContain("Could not update the latest values")
        expect(host.querySelectorAll('[role="button"]')).toHaveLength(3)
        state.failScenarios = false
        await act(async () => buttonNamed("Try again")?.click())
        await settle()
        expect(host.textContent).not.toContain("Could not update the latest values")
        expect(host.textContent).toContain("Success")
        expect(host.textContent).not.toContain("Running")
    })
})
