// @vitest-environment jsdom
import {act, createElement, type ReactNode} from "react"

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

import {ScenarioFocusSheet} from "@/features/evaluation-run/focus/ScenarioFocusSheet"

import {answerRequest, newServerState, type ScenarioServerState} from "./runScenariosFixtures"
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT =
    true

const store = getDefaultStore()
let host: HTMLDivElement
let root: Root
let counter = 0
let tree: ReactNode = null
let state: ScenarioServerState
let client: QueryClient

const settle = (ms = 1000) =>
    act(async () => {
        await vi.advanceTimersByTimeAsync(ms)
    })

const header = (kind: RunHeader["kind"]): RunHeader => ({
    name: "Capitals check",
    description: null,
    status: "evaluation_finished",
    kind,
    flags: {isLive: false, isClosed: false, isActive: false},
    createdAt: null,
    updatedAt: null,
    createdById: null,
})

async function mount(
    focus: string | null,
    patch: Partial<ScenarioServerState> = {},
    kind: RunHeader["kind"] = "auto",
    answer: typeof answerRequest = answerRequest,
) {
    const runId = `run-${++counter}`
    state = newServerState(patch)
    http.post.mockImplementation(async (url: string, body: Record<string, unknown>) =>
        answer(runId, state, url, body),
    )
    client = new QueryClient({defaultOptions: {queries: {retry: false}}})
    store.set(queryClientAtom, client)
    router.query = focus ? {focusScenarioId: focus, focusRunId: runId, tab: "scenarios"} : {}
    tree = createElement(
        Provider,
        {store},
        createElement(
            QueryClientProvider,
            {client},
            createElement(ScenarioFocusSheet, {runId, header: header(kind), poll: true}),
        ),
    )
    await act(async () => root.render(tree))
    await settle()
    await settle()
    return runId
}

/** The same run with an app step: its output column and one result for the invocation. */
const withApp =
    (status: string): typeof answerRequest =>
    (runId, serverState, url, body) => {
        const answer = answerRequest(runId, serverState, url, body)
        if (url.endsWith("/evaluations/runs/query")) {
            answer.data?.runs?.[0].data.mappings.push({
                column: {kind: "invocation", name: "answer"},
                step: {key: "app", path: "attributes.ag.data.outputs"},
            } as never)
        }
        if (url.endsWith("/evaluations/results/query")) {
            const results = answer.data?.results ?? []
            for (const result of [...results]) {
                results.push({...result, step_key: "app", status} as never)
            }
        }
        return answer
    }

/** The same run, where the evaluator failed on every scenario with an error message. */
const evaluatorFailed: typeof answerRequest = (runId, serverState, url, body) => {
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

const dialog = () => document.body.querySelector('[role="dialog"]')
const text = () => dialog()?.textContent ?? ""
const click = (label: string) =>
    act(async () => {
        ;(document.body.querySelector(`[aria-label="${label}"]`) as HTMLElement).click()
    })

beforeEach(() => {
    vi.useFakeTimers()
    host = document.createElement("div")
    document.body.appendChild(host)
    root = createRoot(host)
    store.set(projectIdAtom, "pr")
    store.set(sessionAtom, true)
    Object.values(http).forEach((fn) => fn.mockReset())
    router.replace.mockReset()
    // A navigation changes the address the page reads on its next render.
    router.replace.mockImplementation((target: {query: Record<string, string>}) => {
        router.query = target.query
    })
})

afterEach(() => {
    act(() => root.unmount())
    host.remove()
    vi.useRealTimers()
})

describe("scenario focus drawer", () => {
    it("A focusScenarioId in the URL opens the drawer on that scenario", async () => {
        await mount("sc-2")
        expect(text()).toContain("Test case #2")
        expect(text()).toContain("Japan")
    })

    it("Opening the drawer reads and writes nothing but queries", async () => {
        await mount("sc-2")
        expect(http.put).not.toHaveBeenCalled()
        expect(http.patch).not.toHaveBeenCalled()
        expect(http.delete).not.toHaveBeenCalled()
        const writes = state.calls.filter((call) => !call.url.endsWith("/query"))
        expect(writes).toEqual([])
    })

    it("Closing the drawer removes both focus parameters", async () => {
        await mount("sc-2")
        await click("Close")
        expect(router.replace).toHaveBeenCalledTimes(1)
        expect(router.replace.mock.calls[0][0].query).toEqual({tab: "scenarios"})
    })

    it("A human run labels the scenario Scenario, other runs Test case", async () => {
        await mount("sc-1", {}, "human")
        expect(text()).toContain("Scenario #1")
        expect(text()).not.toContain("Test case")
    })

    it("A live run labels the scenario Trace", async () => {
        await mount("sc-1", {}, "online")
        expect(text()).toContain("Trace #1")
        expect(text()).not.toContain("Test case")
    })

    it("An evaluator that failed shows its error message", async () => {
        await mount(
            "sc-1",
            {scored: false, statuses: {"sc-1": "errors"}},
            "online",
            evaluatorFailed,
        )
        const metrics = document.body.querySelector('[aria-label="Exact Match metrics"]')
        expect(metrics?.querySelector('[role="alert"]')?.textContent).toBe("Invalid regex pattern")
    })

    it("Next on the last loaded row loads the next page", async () => {
        const runId = await mount("sc-2", {pageSize: 2})
        expect(text()).toContain("Test case #2")
        await click("Next")
        await settle()
        expect(router.replace).toHaveBeenCalledTimes(1)
        expect(router.replace.mock.calls[0][0].query).toEqual({
            tab: "scenarios",
            focusScenarioId: "sc-3",
            focusRunId: runId,
        })
        expect(
            state.calls.filter((call) => call.url.endsWith("/evaluations/scenarios/query")),
        ).toHaveLength(2)
        await act(async () => root.render(tree))
        expect(text()).toContain("Test case #3")
    })

    it("A scenario on a later page loads pages until it is found", async () => {
        await mount("sc-3", {pageSize: 1})
        expect(text()).toContain("Test case #3")
        expect(text()).toContain("Chile")
    })

    it("A scenario that is not on any page shows not in this evaluation", async () => {
        await mount("sc-404")
        expect(text()).toContain("This scenario is not in this evaluation")
        await act(async () => {
            ;[...document.body.querySelectorAll("button")]
                .find((button) => button.textContent === "Close")
                ?.click()
        })
        expect(router.replace.mock.calls[0][0].query).toEqual({tab: "scenarios"})
    })

    it("A step still running shows a placeholder in its section", async () => {
        await mount("sc-1", {statuses: {"sc-1": "running"}}, "auto", withApp("running"))
        const outputs = document.body.querySelector('[aria-label="Outputs"]')
        expect(outputs?.querySelector('[aria-label="Running"]')).not.toBeNull()
    })

    it("A failed invocation says it produced no output", async () => {
        await mount("sc-1", {statuses: {"sc-1": "failure"}}, "auto", withApp("failure"))
        expect(text()).toContain("This run did not produce an output")
    })

    it("Each evaluator shows its metrics for the scenario", async () => {
        await mount("sc-1")
        const metrics = document.body.querySelector('[aria-label="Exact Match metrics"]')
        expect(metrics?.textContent).toContain("Exact Match")
        expect(metrics?.textContent).toContain("success")
    })
})
