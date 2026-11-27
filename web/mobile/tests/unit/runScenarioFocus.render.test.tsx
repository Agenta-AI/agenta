// @vitest-environment jsdom
import {act, createElement, type ReactNode} from "react"

import type {RunHeader} from "@agenta/entities/evaluationRun"
import {
    closeTraceDrawerAtom,
    isDrawerOpenAtom,
    traceDrawerQueryAtom,
    traceDrawerTraceIdAtom,
} from "@agenta/observability/traceDrawer"
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
const views = vi.hoisted(() => ({testsets: true}))
vi.mock("@/features/developer/developerViewAccess", () => ({
    useDeveloperViewEnabled: (viewId: string) => (viewId === "testsets" ? views.testsets : false),
}))
vi.mock("next/router", () => ({
    useRouter: () => ({
        query: router.query,
        pathname: "/w/[workspace_id]/p/[project_id]/evaluations/results/[evaluation_id]",
        replace: router.replace,
    }),
}))

import {ScenarioFocusSheet} from "@/features/evaluation-run/focus/ScenarioFocusSheet"

import {
    answerRequest,
    APP_METRICS,
    newServerState,
    type ScenarioServerState,
} from "./runScenariosFixtures"
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT =
    true

const store = getDefaultStore()
let host: HTMLDivElement
let root: Root
let counter = 0
let tree: ReactNode = null
let build: () => ReactNode = () => null
/** Render again with fresh elements, as a page does after the address changes. */
const rerender = () => act(async () => root.render(build()))
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
    build = () =>
        createElement(
            Provider,
            {store},
            createElement(
                QueryClientProvider,
                {client},
                createElement(ScenarioFocusSheet, {runId, header: header(kind), poll: true}),
            ),
        )
    tree = build()
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

const one = (value: number) => ({type: "numeric/continuous", count: 1, mean: value, sum: value})

/**
 * The same run where each step wrote a trace and reports its own call: the app call (522 ms, 128
 * tokens, $0.000012) and the evaluator (887 ms, 126 tokens, no cost). The traces are read in one
 * request per page; the trace API answers with no spans.
 */
const withStepTraces: typeof answerRequest = (runId, serverState, url, body) => {
    const answer = withApp("success")(runId, serverState, url, body)
    if (url.endsWith("/evaluations/results/query")) {
        const results = (answer.data?.results ?? []) as {
            scenario_id: string
            step_key: string
            trace_id?: string
        }[]
        for (const result of results) {
            if (result.step_key === "app") result.trace_id = `${result.scenario_id}-app-trace`
        }
        for (const result of results.filter((entry) => entry.step_key === "app")) {
            results.push({
                ...result,
                step_key: "ev",
                trace_id: `${result.scenario_id}-ev-trace`,
            })
        }
    }
    if (url.endsWith("/evaluations/metrics/query")) {
        for (const metric of (answer.data?.metrics ?? []) as {
            data: Record<string, Record<string, unknown>>
        }[]) {
            metric.data.app = APP_METRICS
            metric.data.ev = {
                ...metric.data.ev,
                "attributes.ag.metrics.duration.cumulative": one(887),
                "attributes.ag.metrics.tokens.cumulative.total": 126,
            }
        }
    }
    return answer
}

/** A span of the app call's trace, as `GET /traces/{trace_id}` and the trace query give it. */
const span = (id: string, extra: Record<string, unknown>) => ({
    trace_id: "t",
    span_id: id,
    start_time: "2026-11-19T19:21:00.000Z",
    end_time: "2026-11-19T19:21:10.000Z",
    ...extra,
})

/** The trace of an app call: its outputs on the root span and two tool calls under it. */
const appTrace = (traceId: string, outputs: unknown, tools = 2) => ({
    trace_id: traceId,
    spans: {
        root: span("root", {
            trace_id: traceId,
            span_type: "agent",
            span_name: "root",
            attributes: {
                ag: {
                    data: {inputs: {}, outputs},
                    metrics: {tokens: {cumulative: {prompt: 100, completion: 28, total: 128}}},
                },
            },
            references: [
                {key: "testset", id: "ts-1"},
                {key: "testcase", id: "tc-x"},
            ],
            spans: Object.fromEntries(
                Array.from({length: tools}, (_, index) => [
                    `tool ${index}`,
                    span(`tool-${index}`, {
                        trace_id: traceId,
                        span_type: "tool",
                        span_name: "execute_tool Bash",
                        start_time: `2026-11-19T19:21:0${index}.000Z`,
                        end_time: `2026-11-19T19:21:0${index + 1}.400Z`,
                        attributes: {
                            ag: {
                                data: {inputs: {command: `pytest -q ${index}`}, outputs: "ok"},
                                meta: {tool: {name: "Bash"}},
                            },
                        },
                    }),
                ]),
            ),
        }),
    },
})

const traceReads: string[] = []
/** What the trace API answers: the output of each app trace, and whether a GET fails. */
const traceApi = {
    outputs: (): unknown => ({answer: "Tokyo"}),
    failGet: false,
}

/** A one-turn chat: the tool calls of the trace show in it. */
const chatOutput = () => [
    {role: "user", content: "Run the tests"},
    {role: "assistant", content: "All tests pass."},
]

/** The evaluator steps with an origin, by step key: `human`, `auto` or `custom`. */
const withOrigins =
    (origins: Record<string, string>, base: typeof answerRequest = answerRequest) =>
    (...args: Parameters<typeof answerRequest>) => {
        const answer = base(...args)
        if (args[2].endsWith("/evaluations/runs/query")) {
            for (const step of (answer.data?.runs?.[0].data.steps ?? []) as {
                key: string
                origin?: string
            }[]) {
                if (origins[step.key]) step.origin = origins[step.key]
            }
        }
        return answer
    }

const dialog = () => document.body.querySelector('[role="dialog"]')
const text = () => dialog()?.textContent ?? ""
const section = (label: string) =>
    document.body.querySelector(`[aria-label="${label}"]`) as HTMLElement
/** A button by its visible text or its name. */
const buttonNamed = (name: string) =>
    [...document.body.querySelectorAll<HTMLElement>("button")].find(
        (button) => button.textContent === name || button.getAttribute("aria-label") === name,
    ) as HTMLElement
const click = (label: string) =>
    act(async () => {
        ;(document.body.querySelector(`[aria-label="${label}"]`) as HTMLElement).click()
    })
const press = (name: string) =>
    act(async () => {
        buttonNamed(name).click()
    })
/** Radix tabs open on mouse down. */
const openTab = (name: string) =>
    act(async () => {
        const tab = [...document.body.querySelectorAll<HTMLElement>('[role="tab"]')].find(
            (candidate) => candidate.textContent === name,
        ) as HTMLElement
        tab.dispatchEvent(new MouseEvent("mousedown", {bubbles: true, button: 0}))
    })
const traceGets = () => traceReads.filter((url) => /\/traces\/(?!query)[^/?]+(\?|$)/.test(url))

/** The run with the app's output column, and each app result pointing at its trace. */
const withAppTrace =
    (patch: (answer: ReturnType<typeof answerRequest>, url: string) => void = () => undefined) =>
    (...args: Parameters<typeof answerRequest>) => {
        const answer = withStepTraces(...args)
        const [, , url] = args
        if (url.endsWith("/evaluations/runs/query")) {
            answer.data?.runs?.[0].data.mappings.forEach((mapping) => {
                if ((mapping as {step: {key: string}}).step.key === "app") {
                    ;(mapping as {step: {path: string}}).step.path = "attributes.ag.data.outputs"
                }
            })
        }
        patch(answer, url)
        return answer
    }

/** The run's test set step names its revision, and each test case its test set. */
const withRevision = withAppTrace((answer, url) => {
    if (url.endsWith("/evaluations/runs/query")) {
        const step = answer.data?.runs?.[0].data.steps[0] as {references: Record<string, unknown>}
        step.references.testset_revision = {id: "rev-4", version: 4}
    }
    if (url.endsWith("/testcases/query")) {
        for (const testcase of (answer.data?.testcases ?? []) as Record<string, unknown>[]) {
            testcase.testset_id = "ts-1"
        }
    }
})

/** A second evaluator, "Aaa check", that passes, listed before Exact Match. */
const withTwoEvaluators: typeof answerRequest = (runId, serverState, url, body) => {
    const answer = answerRequest(runId, serverState, url, body)
    if (url.endsWith("/evaluations/runs/query")) {
        const data = answer.data?.runs?.[0].data
        data?.steps.splice(1, 0, {
            key: "ev0",
            type: "annotation",
            origin: "auto",
            references: {evaluator: {id: "ev-0", slug: "aaa-check"}},
        } as never)
        data?.mappings.splice(1, 0, {
            column: {kind: "annotation", name: "passed"},
            step: {key: "ev0", path: "attributes.ag.data.outputs.passed"},
        } as never)
    }
    if (url.endsWith("/evaluations/metrics/query")) {
        for (const metric of (answer.data?.metrics ?? []) as {
            data: Record<string, Record<string, unknown>>
        }[]) {
            metric.data.ev0 = {
                "attributes.ag.data.outputs.passed": {
                    type: "binary",
                    count: 1,
                    freq: [{value: true, count: 1}],
                },
            }
        }
    }
    return answer
}

beforeEach(() => {
    vi.useFakeTimers()
    host = document.createElement("div")
    document.body.appendChild(host)
    root = createRoot(host)
    store.set(projectIdAtom, "pr")
    store.set(sessionAtom, true)
    Object.values(http).forEach((fn) => fn.mockReset())
    router.replace.mockReset()
    traceReads.length = 0
    views.testsets = true
    traceApi.outputs = () => ({answer: "Tokyo"})
    traceApi.failGet = false
    // The trace API is read with fetch: the page's traces in one query, one trace by id.
    vi.stubGlobal("fetch", async (input: string | URL | Request) => {
        const url = String(input instanceof Request ? input.url : input)
        traceReads.push(url)
        const json = (body: unknown, status = 200) =>
            new Response(JSON.stringify(body), {
                status,
                headers: {"content-type": "application/json"},
            })
        const ids = state.ids.map((id) => `${id}-app-trace`)
        if (url.includes("/traces/query")) {
            if (state.failTraces) return json({detail: "boom"}, 500)
            return json({
                count: ids.length,
                traces: ids.map((id) => appTrace(id, traceApi.outputs())),
            })
        }
        const byId = url.match(/\/traces\/([^/?]+)/)?.[1]
        if (byId) {
            if (traceApi.failGet) return json({detail: "boom"}, 500)
            return json({count: 1, trace: appTrace(byId, traceApi.outputs())})
        }
        return json({count: 0, traces: [], spans: []})
    })
    store.set(closeTraceDrawerAtom)
    // A navigation changes the address the page reads on its next render.
    router.replace.mockImplementation((target: {query: Record<string, string>}) => {
        router.query = target.query
    })
})

afterEach(() => {
    act(() => root.unmount())
    host.remove()
    vi.useRealTimers()
    vi.unstubAllGlobals()
})

describe("scenario focus drawer", () => {
    it("A focusScenarioId in the URL opens the drawer on that scenario", async () => {
        await mount("sc-2")
        expect(text()).toContain("Test case #2")
        expect(text()).toContain("Japan")
    })

    it("Opening the drawer reads and writes nothing but queries", async () => {
        await mount("sc-2", {}, "auto", withAppTrace())
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
        expect(text()).not.toContain("Test case #")
    })

    it("A live run labels the scenario Trace", async () => {
        await mount("sc-1", {}, "online")
        expect(text()).toContain("Trace #1")
        expect(text()).not.toContain("Test case #")
    })

    it("The header shows Passed, duration, tokens and cost of the test case", async () => {
        await mount("sc-2", {failing: ["sc-2"]}, "auto", withStepTraces)
        const header = dialog()?.querySelector('[data-slot="sheet-header"]') as HTMLElement
        expect(header.textContent).toContain("Passed")
        expect(header.textContent).toContain("0 of 1")
        expect(header.textContent).toContain("522ms")
        expect(header.textContent).toContain("128")
        expect(header.textContent).toContain("$0.000012")
        const passed = [...header.querySelectorAll("span")].find(
            (node) => node.textContent === "0 of 1",
        )
        expect(passed?.className).toContain("text-destructive")
    })

    it("A value the test case does not have shows a dash in the header", async () => {
        await mount("sc-1")
        const header = dialog()?.querySelector('[data-slot="sheet-header"]') as HTMLElement
        expect(header.textContent).toContain("1 of 1")
        expect(header.textContent).toContain("Duration—")
        expect(header.textContent).toContain("Cost—")
    })

    it("Open in test set opens the run's revision on this test case", async () => {
        await mount("sc-2", {}, "auto", withRevision)
        router.query = {...router.query, workspace_id: "ws", project_id: "pr"}
        await rerender()
        const link = [...document.body.querySelectorAll("a")].find(
            (anchor) => anchor.textContent === "Open in test set",
        )
        expect(link?.getAttribute("href")).toBe("/w/ws/p/pr/testsets/rev-4?testcase_id=tc-sc-2")
    })

    it("Open in test set is hidden for a live run and when the test sets view is off", async () => {
        await mount("sc-2", {}, "online", withRevision)
        expect(text()).not.toContain("Open in test set")
        act(() => root.unmount())
        root = createRoot(host)
        views.testsets = false
        await mount("sc-2", {}, "auto", withRevision)
        expect(text()).not.toContain("Open in test set")
    })

    it("The tabs and the Formatted or Raw switch stay when moving to the next test case", async () => {
        await mount("sc-1")
        await openTab("Results")
        expect(section("Evaluators")).not.toBeNull()
        await press("Raw")
        expect(section("Test case as JSON")?.textContent).toContain('"evaluators"')
        await click("Next")
        await rerender()
        expect(text()).toContain("Test case #2")
        expect(section("Test case as JSON")?.textContent).toContain('"Exact Match"')
        await press("Formatted")
        expect(section("Evaluators")).not.toBeNull()
    })

    it("Raw shows the open tab's JSON, and Copy as JSON copies the whole test case", async () => {
        const writeText = vi.fn(async () => undefined)
        vi.stubGlobal("navigator", {...navigator, clipboard: {writeText}})
        await mount("sc-2", {failing: ["sc-2"]})
        await press("Raw")
        expect(JSON.parse(section("Test case as JSON").textContent ?? "{}")).toEqual({
            inputs: {country: "Japan"},
            outputs: {},
        })
        await click("Copy as JSON")
        expect(writeText).toHaveBeenCalledWith(
            JSON.stringify(
                {
                    inputs: {country: "Japan"},
                    outputs: {},
                    evaluators: {"Exact Match": {success: false}},
                },
                null,
                2,
            ),
        )
    })

    it("The inputs show as one table, short values first", async () => {
        await mount("sc-2")
        const inputs = section("Inputs")
        expect(inputs.textContent).toContain("1 field")
        expect(inputs.textContent).toContain("country")
        expect(inputs.textContent).toContain("Japan")
    })

    it("An output of messages shows as a chat with the middle folded", async () => {
        traceApi.outputs = () =>
            Array.from({length: 9}, (_, index) => ({
                role: index % 2 ? "assistant" : "user",
                content: `message ${index + 1}`,
            }))
        await mount("sc-1", {}, "auto", withAppTrace())
        const output = section("Output")
        expect(output.textContent).toContain("conversation, 9 messages")
        expect(output.textContent).toContain("message 1")
        expect(output.textContent).toContain("message 9")
        expect(output.textContent).toContain("5 more messages")
        expect(output.textContent).not.toContain("message 5")
    })

    it("An output that is JSON written as text shows as key rows, parsed from text", async () => {
        traceApi.outputs = () => '{"tier": "gold", "seats": 4}'
        await mount("sc-1", {}, "auto", withAppTrace())
        const output = section("Output")
        expect(output.textContent).toContain("parsed from text")
        expect(output.textContent).toContain("tier")
        expect(output.textContent).toContain("gold")
    })

    it("An object output shows next to the expected value with a mark per field", async () => {
        traceApi.outputs = () => ({tier: "gold", seats: 4})
        const expected = withAppTrace((answer, url) => {
            if (url.endsWith("/evaluations/runs/query")) {
                const step = answer.data?.runs?.[0].data.steps.find(
                    (candidate) => (candidate as {key: string}).key === "ev",
                ) as {references: Record<string, unknown>}
                step.references.evaluator_revision = {id: "evr-1"}
                answer.data?.runs?.[0].data.mappings.push({
                    column: {kind: "testset", name: "correct_answer"},
                    step: {key: "ts", path: "data.correct_answer"},
                } as never)
            }
            if (url.endsWith("/testcases/query")) {
                for (const testcase of (answer.data?.testcases ?? []) as {
                    data: Record<string, unknown>
                }[]) {
                    testcase.data.correct_answer = {tier: "gold", seats: 5}
                }
            }
        })
        const revision = {
            id: "evr-1",
            workflow_id: "ev-1",
            slug: "exact-match",
            flags: {},
            data: {parameters: {correct_answer_key: "correct_answer"}},
        }
        await mount("sc-1", {}, "auto", (runId, serverState, url, body) =>
            url.includes("/workflows/revisions")
                ? ({
                      data: {count: 1, workflow_revisions: [revision], workflow_revision: revision},
                  } as never)
                : expected(runId, serverState, url, body),
        )
        await settle()
        const output = section("Output")
        expect(output.textContent).toContain("1 of 2 fields match")
        expect(output.textContent).toContain("expected (from correct_answer)")
        expect(output.querySelector('[aria-label="Match"]')).not.toBeNull()
        expect(output.querySelector('[aria-label="Mismatch"]')).not.toBeNull()
    })

    it("Without a compared column the output has no expected column", async () => {
        traceApi.outputs = () => ({tier: "gold", seats: 4})
        await mount("sc-1", {}, "auto", withAppTrace())
        const output = section("Output")
        expect(output.textContent).not.toContain("expected")
        expect(output.querySelector('[aria-label="Match"]')).toBeNull()
    })

    it("The tool calls load once with the drawer, and opening the trace reads nothing more", async () => {
        traceApi.outputs = chatOutput
        await mount("sc-1", {}, "auto", withAppTrace())
        await settle()
        expect(traceGets()).toHaveLength(1)
        expect(traceGets()[0]).toContain("/traces/sc-1-app-trace")
        const output = section("Output")
        expect(output.textContent).toContain("Worked for")
        await act(async () => {
            ;[...output.querySelectorAll("button")]
                .find((button) => button.textContent?.includes("Worked for"))
                ?.click()
        })
        expect(output.textContent).toContain("pytest -q 0")
        expect(output.textContent).toContain("1.4 s")
        await click("Open Output trace")
        expect(store.get(traceDrawerTraceIdAtom)).toBe("sc-1-app-trace")
        const unsubscribe = store.sub(traceDrawerQueryAtom, () => undefined)
        await settle()
        expect(store.get(traceDrawerQueryAtom).data).toBeTruthy()
        unsubscribe()
        expect(traceGets()).toHaveLength(1)
    })

    it("A trace that did not load says so with Try again", async () => {
        traceApi.outputs = chatOutput
        traceApi.failGet = true
        await mount("sc-1", {}, "auto", withAppTrace())
        // The trace client retries a failed read with a backoff before it gives up.
        await settle(30_000)
        expect(section("Output").textContent).toContain("Could not load the tool calls")
        traceApi.failGet = false
        await press("Try again")
        await settle()
        expect(section("Output").textContent).not.toContain("Could not load the tool calls")
        expect(section("Output").textContent).toContain("Worked for")
    })

    it("No trace is read while the app call runs", async () => {
        await mount("sc-1", {statuses: {"sc-1": "running"}}, "auto", withApp("running"))
        expect(traceGets()).toHaveLength(0)
        expect(section("Output")?.querySelector('[aria-label="Running"]')).not.toBeNull()
    })

    it("Results lists one row per evaluator, failed first", async () => {
        await mount("sc-1", {failing: ["sc-1"]}, "auto", withTwoEvaluators)
        await openTab("Results")
        const rows = section("Evaluators").textContent ?? ""
        expect(rows).toContain("2 evaluators")
        expect(rows.indexOf("Exact Match")).toBeLessThan(rows.toLowerCase().indexOf("aaa"))
        expect(rows).toContain("Fail")
        expect(rows).toContain("Pass")
    })

    it("Human evaluators go in their own group and do not count in Passed", async () => {
        await mount(
            "sc-1",
            {failing: ["sc-1"]},
            "auto",
            withOrigins({ev0: "human"}, withTwoEvaluators),
        )
        const header = dialog()?.querySelector('[data-slot="sheet-header"]') as HTMLElement
        expect(header.textContent).toContain("0 of 1")
        await openTab("Results")
        expect(section("Evaluators").textContent).toContain("Exact Match")
        expect(section("Evaluators").textContent?.toLowerCase()).not.toContain("aaa")
        const human = section("Human annotations")
        expect(human.textContent?.toLowerCase()).toContain("aaa")
        expect(human.textContent).toContain("human evaluator")
        expect(human.textContent).toContain("True")
    })

    it("A test case with only human evaluators shows no passed count", async () => {
        await mount("sc-1", {}, "human", withOrigins({ev: "human"}))
        const header = dialog()?.querySelector('[data-slot="sheet-header"]') as HTMLElement
        expect(header.textContent).not.toContain("Passed")
        expect(header.textContent).toContain("Duration")
    })

    it("An evaluator that failed shows Error, and its message on expand", async () => {
        await mount(
            "sc-1",
            {scored: false, statuses: {"sc-1": "errors"}},
            "online",
            evaluatorFailed,
        )
        await openTab("Results")
        expect(section("Evaluators").textContent).toContain("Error")
        await press("Exact Match")
        expect(section("Evaluators").textContent).toContain("Invalid regex pattern")
    })

    it("A step's trace button opens that step's trace in the trace drawer", async () => {
        await mount("sc-2", {}, "auto", withStepTraces)
        expect(store.get(isDrawerOpenAtom)).toBe(false)
        await openTab("Results")
        await click("Open Exact Match trace")
        expect(store.get(isDrawerOpenAtom)).toBe(true)
        expect(store.get(traceDrawerTraceIdAtom)).toBe("sc-2-ev-trace")
    })

    it("An evaluator row opens to the evaluator call's duration and tokens", async () => {
        await mount("sc-1", {}, "auto", withStepTraces)
        await openTab("Results")
        await press("Exact Match")
        const evaluators = section("Evaluators")
        expect(evaluators.textContent).toContain("887ms")
        expect(evaluators.textContent).toContain("126")
    })

    it("Metadata shows the app call's metrics with the token split and the ids", async () => {
        await mount("sc-1", {}, "auto", withAppTrace())
        await openTab("Metadata")
        const metrics = section("Metrics")
        expect(metrics.textContent).toContain("522ms")
        expect(metrics.textContent).toContain("Total Tokens128")
        expect(metrics.textContent).toContain("Input100")
        expect(metrics.textContent).toContain("Output28")
        expect(metrics.textContent).toContain("Tool calls2")
        const references = section("References")
        expect(references.textContent).toContain("tc-sc-1")
        expect(references.textContent).toContain("sc-1")
        expect(references.textContent).toContain("sc-1-app-trace")
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

    it("Values that did not load show the error with Retry", async () => {
        await mount("sc-1", {failTraces: true})
        // The trace client retries a failed read with a backoff before it gives up.
        await settle(30_000)
        expect(text()).toContain("Could not load these values")
    })

    it("A failed app call says so with its error, and its evaluators did not run", async () => {
        await mount(
            "sc-1",
            {statuses: {"sc-1": "failure"}, scored: false},
            "auto",
            withApp("failure"),
        )
        const output = section("Output")
        expect(output.textContent).toContain("The app call failed")
        expect(output.textContent).toContain("This run did not produce an output")
        expect(traceGets()).toHaveLength(0)
        await openTab("Results")
        expect(section("Evaluators").textContent).toContain("Not run, the app call failed")
    })

    it("A human run with no output says No output yet", async () => {
        await mount("sc-1", {}, "human", withApp("pending"))
        expect(section("Output").textContent).toContain("No output yet")
    })

    it("The traces of a page are read in one request, and moving on reads none", async () => {
        await mount("sc-1", {}, "auto", withStepTraces)
        const reads = traceReads.filter((url) => url.includes("/traces/query"))
        expect(reads).toHaveLength(1)
        await click("Next")
        await settle()
        await rerender()
        expect(text()).toContain("Test case #2")
        expect(traceReads.filter((url) => url.includes("/traces/query"))).toHaveLength(1)
    })
})
