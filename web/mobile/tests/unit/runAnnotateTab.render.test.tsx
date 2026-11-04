// @vitest-environment jsdom
/**
 * The Annotate tab and the annotate sheet of a human evaluation run. The annotation controllers,
 * the run molecules and the annotation API functions are the real ones; only the HTTP client, the
 * permission check and the toast are replaced, so the asserted bodies are what the API receives.
 */
import {act, createElement, type ReactNode} from "react"

import {annotationFormController} from "@agenta/annotation"
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
    client: null as unknown,
}))
vi.mock("@agenta/shared/api", async (original) => {
    const actual = await original<typeof import("@agenta/shared/api")>()
    return {
        ...actual,
        axios: {...actual.axios, ...http},
        getAgentaApiUrl: () => "https://agenta.test/api",
        getHostQueryClient: () => http.client,
    }
})

// Traces (the app output, the annotation values of a row) are read through the traces client.
const traceReads = vi.hoisted(() => vi.fn(async (_request: unknown) => ({traces: []})))
vi.mock("@agenta/sdk/resources", async (original) => {
    const traces = {queryTraces: traceReads, querySpans: async () => ({spans: []})}
    return {
        ...(await original<typeof import("@agenta/sdk/resources")>()),
        getTracesClient: () => traces,
        getLowPriorityTracesClient: () => traces,
    }
})

const toast = vi.hoisted(() => ({success: vi.fn(), error: vi.fn(), info: vi.fn()}))
vi.mock("@agenta/ui/app-message", () => ({message: toast}))

const access = vi.hoisted(() => ({canAnnotate: true, canRun: true}))
vi.mock("@/features/context/useProjectPermission", () => ({
    useProjectPermission: (_projectId: string, action: string) =>
        action === "edit_evaluation_results" ? access.canRun : access.canAnnotate,
}))

const router = vi.hoisted(() => ({query: {} as Record<string, string>, replace: vi.fn()}))
vi.mock("next/router", () => ({
    useRouter: () => ({
        query: router.query,
        pathname: "/w/[workspace_id]/p/[project_id]/evaluations/results/[evaluation_id]",
        replace: router.replace,
    }),
}))

import {RunAnnotateTab} from "@/features/evaluation-run/focus/RunAnnotateTab"
import {ScenariosTab} from "@/features/evaluation-run/scenarios/ScenariosTab"

import {answerRequest, newServerState, type ScenarioServerState} from "./runScenariosFixtures"
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT =
    true

const PROJECT = "pr"
const API = "https://agenta.test/api"
const store = getDefaultStore()
let host: HTMLDivElement
let root: Root
let counter = 0
let state: ScenarioServerState
let client: QueryClient

/** What the server holds beyond the shared fixtures: outputs and annotations per scenario. */
interface HumanRun {
    /** Scenarios whose app step has run, with its trace. */
    outputs: string[]
    /** Scenarios that already carry a Quality annotation, with its value. */
    annotated: Record<string, boolean>
    /** False: the run has no human evaluator. */
    withEvaluator: boolean
    /** True: creating an annotation fails. */
    failCreate: boolean
    /** True: the app step is a human step that points at an app revision, as a run made in /m. */
    humanInvocation: boolean
}
let human: HumanRun

const QUALITY = {
    id: "rev-quality",
    workflow_id: "wf-quality",
    slug: "quality",
    name: "Quality",
    description: "Is the answer right",
    flags: {is_evaluator: true, is_feedback: true},
    data: {schemas: {outputs: {type: "object", properties: {good: {type: "boolean"}}}}},
}

const APP_ID = "0190a000-0000-7000-8000-00000000a001"
const VARIANT_ID = "0190a000-0000-7000-8000-00000000a002"
const REVISION_ID = "0190a000-0000-7000-8000-00000000a003"
const APP_REVISION = {
    id: REVISION_ID,
    slug: "geo-bot-v1",
    version: 1,
    workflow_id: APP_ID,
    workflow_variant_id: VARIANT_ID,
    flags: {is_chat: false},
    data: {
        uri: "agenta:custom:completion:v0",
        url: "https://svc.test/services/geo",
        parameters: {temperature: 0},
    },
}
const TRACE_HEX = "0123456789abcdef0123456789abcdef"
const SPAN_HEX = "0123456789abcdef"

/** The app the human run calls: `fetch` from the playground runner. */
const appCall = vi.hoisted(() => vi.fn())

const header: RunHeader = {
    name: "Capitals review",
    description: null,
    status: "running",
    kind: "human",
    flags: {isLive: false, isClosed: false, isActive: false},
    createdAt: null,
    updatedAt: null,
    createdById: null,
}

const annotationOf = (scenarioId: string, good: boolean) => ({
    trace_id: `ann-${scenarioId}`,
    span_id: `ann-span-${scenarioId}`,
    data: {outputs: {good}},
    references: {evaluator: {id: "wf-quality", slug: "quality"}},
    links: {app: {trace_id: `trace-${scenarioId}`, span_id: `span-${scenarioId}`}},
    origin: "human",
    kind: "adhoc",
    channel: "web",
    meta: {name: "Quality", description: "", tags: ["good"]},
})

/** The human run: the shared fixture with an app step, a human evaluator and its results. */
function answer(runId: string, url: string, body: Record<string, unknown> | undefined) {
    if (url.endsWith("/simple/traces/")) {
        state.calls.push({url, body})
        if (human.failCreate) throw new Error("Request failed with status code 500")
        // The server keeps the annotation: the next read of the scenario returns it.
        const trace = body?.trace as {
            references: {testcase: {id: string}}
            data: {outputs: {good: boolean}}
        }
        const id = trace.references.testcase.id.replace("tc-", "")
        human.annotated[id] = trace.data.outputs.good
        return {data: {trace: annotationOf(id, trace.data.outputs.good)}}
    }
    if (url.endsWith("/simple/traces/query")) {
        state.calls.push({url, body})
        const links = ((body?.links ?? []) as {trace_id: string}[]).map((link) => link.trace_id)
        const annotations = Object.entries(human.annotated)
            .filter(([id]) => links.includes(`ann-${id}`))
            .map(([id, good]) => annotationOf(id, good))
        return {data: {count: annotations.length, traces: annotations}}
    }
    if (url.endsWith("/evaluations/results/")) {
        state.calls.push({url, body})
        // The server keeps a successful app result: the next read of the scenario returns it.
        for (const result of (body?.results ?? []) as Record<string, string>[]) {
            if (result.step_key === "app" && result.status === "success") {
                human.outputs.push(result.scenario_id)
            }
        }
        return {data: {}}
    }
    if (url.endsWith("/evaluations/metrics/") || url.endsWith("/evaluations/metrics/refresh")) {
        state.calls.push({url, body})
        return {data: {}}
    }
    const reply = answerRequest(runId, state, url, body)
    if (url.endsWith("/evaluations/runs/query")) {
        const run = reply.data?.runs?.[0] as unknown as {
            data: {steps: Record<string, unknown>[]; mappings: Record<string, unknown>[]}
        }
        run.data.steps = run.data.steps.filter((step) => step.type !== "annotation")
        run.data.mappings = run.data.mappings.filter(
            (mapping) => (mapping.column as {kind: string}).kind !== "annotation",
        )
        if (human.humanInvocation) {
            const app = run.data.steps.find((step) => step.key === "app")
            Object.assign(app ?? {}, {
                origin: "human",
                references: {
                    application: {id: APP_ID},
                    application_variant: {id: VARIANT_ID},
                    application_revision: {id: REVISION_ID},
                },
            })
        }
        if (human.withEvaluator) {
            run.data.steps.push({
                key: "app.quality",
                type: "annotation",
                origin: "human",
                references: {evaluator: {id: "wf-quality", slug: "quality"}},
            })
        }
    }
    if (url.endsWith("/evaluations/results/query")) {
        const results = (reply.data?.results ?? []) as unknown as Record<string, unknown>[]
        for (const result of [...results]) {
            const id = result.scenario_id as string
            if (human.outputs.includes(id)) {
                results.push({
                    ...result,
                    id: `app-${id}`,
                    step_key: "app",
                    status: "success",
                    trace_id: `trace-${id}`,
                    span_id: `span-${id}`,
                    testcase_id: undefined,
                })
            }
            if (id in human.annotated) {
                results.push({
                    ...result,
                    id: `quality-${id}`,
                    step_key: "app.quality",
                    status: "success",
                    trace_id: `ann-${id}`,
                    span_id: `ann-span-${id}`,
                    testcase_id: undefined,
                })
            }
        }
    }
    return reply
}

const settle = (ms = 1000) =>
    act(async () => {
        await vi.advanceTimersByTimeAsync(ms)
    })

async function mount(
    view: ReactNode | ((runId: string) => ReactNode),
    patch: Partial<HumanRun>,
    serverPatch: Partial<ScenarioServerState> = {},
) {
    const runId = `run-${++counter}`
    state = newServerState({runStatus: "running", statuses: {"sc-3": "pending"}, ...serverPatch})
    human = {
        outputs: ["sc-1", "sc-2"],
        annotated: {},
        withEvaluator: true,
        failCreate: false,
        humanInvocation: false,
        ...patch,
    }
    http.get.mockImplementation(async (url: string) => {
        state.calls.push({url, body: undefined})
        if (url === `${API}/workflows/revisions/${REVISION_ID}`) {
            return {data: {count: 1, workflow_revision: APP_REVISION}}
        }
        throw new Error(`unexpected GET ${url}`)
    })
    http.post.mockImplementation(async (url: string, body: Record<string, unknown>) =>
        answer(runId, url, body),
    )
    http.patch.mockImplementation(async (url: string, body: unknown) => {
        state.calls.push({url, body})
        const updated = url.match(/simple\/traces\/ann-([^/]+)$/)
        if (updated) {
            human.annotated[updated[1]] = (
                body as {trace: {data: {outputs: {good: boolean}}}}
            ).trace.data.outputs.good
        }
        return {data: {}}
    })
    client = new QueryClient({defaultOptions: {queries: {retry: false}}})
    http.client = client
    client.setQueryData(["workflows", "latestRevision", "wf-quality", PROJECT], QUALITY)
    store.set(queryClientAtom, client)
    const content = typeof view === "function" ? view(runId) : view
    await act(async () =>
        root.render(
            createElement(Provider, {store}, createElement(QueryClientProvider, {client}, content)),
        ),
    )
    for (let i = 0; i < 5; i++) await settle()
    return runId
}

const mountTab = (patch: Partial<HumanRun> = {}) =>
    mount((runId) => createElement(RunAnnotateTab, {runId, header}), patch)

const text = () => document.body.textContent ?? ""
const buttons = () => [...document.body.querySelectorAll("button")]
const button = (label: string) =>
    buttons().find(
        (entry) => entry.textContent === label || entry.getAttribute("aria-label") === label,
    )
const click = async (label: string) => {
    const target = button(label)
    if (!target) throw new Error(`no button ${label}`)
    await act(async () => target.click())
    await settle()
}
const writes = () => state.calls.filter((call) => !call.url.endsWith("/query"))
const bodyOf = (url: string) => writes().find((call) => call.url === `${API}${url}`)?.body

beforeEach(() => {
    vi.useFakeTimers()
    host = document.createElement("div")
    document.body.appendChild(host)
    root = createRoot(host)
    store.set(projectIdAtom, PROJECT)
    store.set(sessionAtom, true)
    Object.values(toast).forEach((fn) => fn.mockReset())
    for (const fn of [http.post, http.patch, http.put, http.delete, http.get]) fn.mockReset()
    router.query = {view: "focus"}
    router.replace.mockReset()
    access.canAnnotate = true
    access.canRun = true
    appCall.mockReset()
    vi.stubGlobal("fetch", appCall)
})

afterEach(async () => {
    act(() => root.unmount())
    // Requests batched in the last frame of a test must leave before its fake clock is dropped.
    await settle()
    // Unsaved values live in the shared form store by scenario id; every test starts clean.
    for (const id of ["sc-1", "sc-2", "sc-3"]) annotationFormController.set.resetEdits(id)
    host.remove()
    vi.useRealTimers()
    vi.unstubAllGlobals()
})

describe("run annotate tab", () => {
    it("Annotate saves and shows Annotations saved successfully", async () => {
        const runId = await mountTab()
        expect(text()).toContain("Scenario #1")
        expect(button("Annotate")?.disabled).toBe(true)

        await click("True")
        expect(button("Annotate")?.disabled).toBe(false)
        await click("Annotate")
        await settle()

        expect(bodyOf("/simple/traces/")).toEqual({
            trace: {
                data: {outputs: {good: true}},
                references: {
                    evaluator: {id: "wf-quality", slug: "quality"},
                    testset: {id: "ts-1"},
                    testcase: {id: "tc-sc-1"},
                },
                links: {app: {trace_id: "trace-sc-1", span_id: "span-sc-1"}},
                origin: "human",
                kind: "adhoc",
                channel: "web",
                meta: {name: "Quality", description: "Is the answer right", tags: ["good"]},
            },
        })
        expect(bodyOf("/evaluations/results/")).toEqual({
            results: [
                {
                    run_id: runId,
                    scenario_id: "sc-1",
                    step_key: "app.quality",
                    status: "success",
                    trace_id: "ann-sc-1",
                    span_id: "ann-span-sc-1",
                },
            ],
        })
        expect(toast.success).toHaveBeenCalledWith("Annotations saved successfully")
        expect(toast.error).not.toHaveBeenCalled()
        // The saved value is now the form's starting point: nothing is left to save.
        expect(button("Annotate")?.disabled).toBe(true)
    })

    it("Existing annotations fill the form and submit as updates", async () => {
        await mountTab({annotated: {"sc-1": false}})
        const chosen = document.body.querySelector('[role="radio"][aria-checked="true"]')
        expect(chosen?.textContent).toBe("False")
        expect(button("Annotate")?.disabled).toBe(true)

        // The Scenarios rows read a text value from the annotation's trace, which is cached.
        const annotationTrace = ["trace-entity", PROJECT, "ann-sc-1"]
        const before = {traces: {}}
        client.setQueryData(annotationTrace, before)
        await click("True")
        traceReads.mockClear()
        await click("Annotate")
        await settle()

        // The cached copy is dropped, and the refreshed rows read the annotation trace again.
        expect(client.getQueryData(annotationTrace)).not.toBe(before)
        // The traces client takes ids without dashes.
        expect(JSON.stringify(traceReads.mock.calls)).toContain("annsc1")
        expect(bodyOf("/simple/traces/")).toBeUndefined()
        const update = writes().find((call) => call.url.includes("/simple/traces/ann-sc-1"))
        expect(update?.url).toBe(`${API}/simple/traces/ann-sc-1`)
        expect(update?.body).toEqual({
            trace: {
                data: {outputs: {good: true}},
                meta: {name: "Quality", description: "", tags: ["good"]},
                references: {evaluator: {id: "wf-quality", slug: "quality"}},
                links: {app: {trace_id: "trace-sc-1", span_id: "span-sc-1"}},
            },
        })
        expect(toast.success).toHaveBeenCalledWith("Annotations saved successfully")
    })

    it("Leaving during a save still drops the replaced annotation's cached trace", async () => {
        await mountTab({annotated: {"sc-1": false}})
        const annotationTrace = ["trace-entity", PROJECT, "ann-sc-1"]
        const before = {traces: {}}
        client.setQueryData(annotationTrace, before)
        const answerPatch = http.patch.getMockImplementation()
        let finish: () => void = () => undefined
        http.patch.mockImplementation(async (url: string, body: unknown) => {
            if (url.includes("/simple/traces/")) {
                await new Promise<void>((resolve) => {
                    finish = resolve
                })
            }
            return answerPatch?.(url, body)
        })
        await click("True")
        await click("Annotate")

        // The reader leaves the tab while the update is on its way.
        await act(async () => root.unmount())
        root = createRoot(host)
        state.calls.length = 0
        finish()
        for (let i = 0; i < 3; i++) await settle()

        expect(toast.success).toHaveBeenCalledWith("Annotations saved successfully")
        expect(client.getQueryData(annotationTrace)).toBeUndefined()
        // The scenario's results are read again, so a form opened next finds the saved annotation.
        const resultReads = state.calls.filter((call) =>
            call.url.endsWith("/evaluations/results/query"),
        )
        expect(resultReads.map((call) => call.body)).toContainEqual(
            expect.objectContaining({result: expect.objectContaining({scenario_ids: ["sc-1"]})}),
        )
    })

    it("A failed submit shows Couldn't save the annotations and keeps the values", async () => {
        vi.spyOn(console, "error").mockImplementation(() => undefined)
        await mountTab({failCreate: true})
        await click("True")
        await click("Annotate")
        await settle()

        expect(toast.error).toHaveBeenCalledWith("Couldn't save the annotations")
        expect(toast.success).not.toHaveBeenCalled()
        expect(text()).toContain("Couldn't save the annotations")
        const chosen = document.body.querySelector('[role="radio"][aria-checked="true"]')
        expect(chosen?.textContent).toBe("True")
        expect(bodyOf("/evaluations/results/")).toBeUndefined()
    })

    it("A run without human evaluators shows No evaluators configured for this run.", async () => {
        await mountTab({withEvaluator: false})
        expect(text()).toContain("No evaluators configured for this run.")
        expect(button("Annotate")).toBeUndefined()
    })

    it("A scenario without output asks to run the invocation and sends nothing", async () => {
        await mountTab({outputs: []})
        expect(text()).toContain("Run the invocation to generate output before annotating.")
        expect(button("Annotate")).toBeUndefined()
        expect(writes()).toEqual([])
    })

    it("A run without scenarios shows No scenarios to display.", async () => {
        await mount((runId) => createElement(RunAnnotateTab, {runId, header}), {}, {ids: []})
        expect(text()).toContain("No scenarios to display.")
    })

    it("A reader without edit rights sees a read-only form", async () => {
        access.canAnnotate = false
        await mountTab({annotated: {"sc-1": true}})
        expect(button("Annotate")).toBeUndefined()
        expect(button("False")?.closest("[inert]")).not.toBeNull()
    })

    it("Cmd or Ctrl+Enter saves the form, and a reader without edit rights saves nothing", async () => {
        await mountTab()
        await click("True")
        const save = () =>
            act(async () => {
                document.dispatchEvent(
                    new KeyboardEvent("keydown", {key: "Enter", ctrlKey: true, bubbles: true}),
                )
            })
        await save()
        await settle()
        expect(bodyOf("/simple/traces/")).toBeDefined()
        expect(toast.success).toHaveBeenCalledWith("Annotations saved successfully")

        await act(async () => root.unmount())
        root = createRoot(host)
        access.canAnnotate = false
        await mountTab()
        // A change is pending, so only the missing edit right stops the save.
        await act(async () =>
            annotationFormController.set.updateMetric({
                scenarioId: "sc-1",
                slug: "quality",
                fieldKey: "good",
                value: false,
            }),
        )
        state.calls.length = 0
        await save()
        await settle()
        expect(writes()).toEqual([])
    })

    it("Next moves the form to the next scenario", async () => {
        await mountTab({annotated: {"sc-2": false}})
        await click("Next")
        expect(text()).toContain("Scenario #2")
        const chosen = document.body.querySelector('[role="radio"][aria-checked="true"]')
        expect(chosen?.textContent).toBe("False")
    })
})

describe("run annotate sheet", () => {
    it("The row action opens the sheet titled Annotate scenario on that scenario", async () => {
        router.query = {view: "scenarios"}
        await mount((runId) => createElement(ScenariosTab, {runId, header}), {})
        const actions = () => buttons().filter((entry) => entry.textContent === "Annotate")
        await act(() => vi.waitFor(() => expect(actions()).toHaveLength(3)))
        await act(async () => actions()[1].click())
        // The sheet is loaded on demand.
        await act(async () => vi.dynamicImportSettled())
        for (let i = 0; i < 5; i++) await settle()

        const dialog = document.body.querySelector('[role="dialog"]')
        expect(dialog?.textContent).toContain("Annotate scenario")
        expect(dialog?.textContent).toContain("Scenario #2")
        // The action opens the sheet, not the scenario drawer.
        expect(router.replace).not.toHaveBeenCalled()

        const inSheet = (label: string) =>
            [...(dialog?.querySelectorAll("button") ?? [])].find(
                (entry) => entry.textContent === label,
            )
        await act(async () => inSheet("True")?.click())
        await act(async () => inSheet("Annotate")?.click())
        for (let i = 0; i < 3; i++) await settle()
        const created = bodyOf("/simple/traces/") as {trace: {links: unknown}}
        expect(created.trace.links).toEqual({
            app: {trace_id: "trace-sc-2", span_id: "span-sc-2"},
        })
        expect(toast.success).toHaveBeenCalledWith("Annotations saved successfully")
    })
})

describe("run the app of a human run", () => {
    const appAnswers = (status: number, body: unknown) =>
        appCall.mockResolvedValue(
            new Response(JSON.stringify(body), {
                status,
                headers: {"Content-Type": "application/json"},
            }),
        )
    /** A run made in /m: no scenario has run its app yet. */
    const pending = () => ({outputs: [] as string[], humanInvocation: true})
    /** Run loads the runner on demand, then calls the app and stores the result. */
    const run = async (label = "Run") => {
        await click(label)
        await act(async () => vi.dynamicImportSettled())
        for (let i = 0; i < 5; i++) await settle()
    }

    it("A pending invocation shows Generate output to annotate with a Run button", async () => {
        await mountTab(pending())
        expect(text()).toContain("Generate output to annotate")
        expect(button("Run")?.disabled).toBe(false)
        expect(button("Annotate")).toBeUndefined()
    })

    it("Opening a scenario with a pending invocation sends no request until Run is clicked", async () => {
        await mountTab(pending())
        await click("Next")
        expect(text()).toContain("Scenario #2")
        expect(appCall).not.toHaveBeenCalled()
        expect(http.get).not.toHaveBeenCalled()
        expect(writes()).toEqual([])
    })

    it("Run calls the app and then shows the form", async () => {
        appAnswers(200, {data: "Paris", trace_id: TRACE_HEX, span_id: SPAN_HEX})
        const runId = await mountTab(pending())

        await run()

        expect(appCall).toHaveBeenCalledOnce()
        const [, init] = appCall.mock.calls[0]
        expect(JSON.parse(init.body).data.inputs).toEqual({country: "France"})
        expect(bodyOf("/evaluations/results/")).toEqual({
            results: [
                {
                    run_id: runId,
                    scenario_id: "sc-1",
                    step_key: "app",
                    status: "success",
                    trace_id: "01234567-89ab-cdef-0123-456789abcdef",
                    span_id: "01234567-89ab-cdef-0123-456789abcdef",
                    references: {
                        application: {id: APP_ID},
                        application_variant: {id: VARIANT_ID},
                        application_revision: {id: REVISION_ID},
                    },
                    outputs: "Paris",
                },
            ],
        })
        expect(toast.success).toHaveBeenCalledWith("Invocation completed")
        expect(text()).not.toContain("Generate output to annotate")

        // The scenario can now be annotated.
        await click("True")
        await click("Annotate")
        await settle()
        const created = bodyOf("/simple/traces/") as {trace: {links: unknown}}
        expect(created.trace.links).toEqual({app: {trace_id: "trace-sc-1", span_id: "span-sc-1"}})
        expect(toast.success).toHaveBeenCalledWith("Annotations saved successfully")
    })

    it("A failed run shows Couldn't run this scenario and Run again", async () => {
        vi.spyOn(console, "error").mockImplementation(() => undefined)
        appAnswers(500, {detail: "The model refused"})
        await mountTab(pending())

        await run()

        expect(toast.error).toHaveBeenCalledWith("Couldn't run this scenario")
        expect(text()).toContain("Couldn't run this scenario")
        // The raw error stays out of the screen.
        expect(text()).not.toContain("The model refused")
        expect(bodyOf("/evaluations/scenarios/")).toEqual({
            scenarios: [{id: "sc-1", status: "failure"}],
        })

        appAnswers(200, {data: "Paris", trace_id: TRACE_HEX})
        await run("Run again")
        expect(appCall).toHaveBeenCalledTimes(2)
        expect(toast.success).toHaveBeenCalledWith("Invocation completed")
        expect(text()).not.toContain("Couldn't run this scenario")
    })

    it("A reader without the right to write results sees no Run button", async () => {
        access.canRun = false
        await mountTab(pending())
        expect(button("Run")).toBeUndefined()
        expect(text()).toContain("Run the invocation to generate output before annotating.")
    })

    it("Cmd or Ctrl+Enter runs the app while the scenario has no output", async () => {
        appAnswers(200, {data: "Paris", trace_id: TRACE_HEX})
        await mountTab(pending())
        await act(async () => {
            document.dispatchEvent(
                new KeyboardEvent("keydown", {key: "Enter", ctrlKey: true, bubbles: true}),
            )
        })
        await act(async () => vi.dynamicImportSettled())
        for (let i = 0; i < 5; i++) await settle()
        expect(appCall).toHaveBeenCalledOnce()
    })

    it("The annotate sheet has the same Run button", async () => {
        appAnswers(200, {data: "Lima", trace_id: TRACE_HEX})
        router.query = {view: "scenarios"}
        await mount((runId) => createElement(ScenariosTab, {runId, header}), pending())
        const actions = () => buttons().filter((entry) => entry.textContent === "Annotate")
        await act(() => vi.waitFor(() => expect(actions()).toHaveLength(3)))
        await act(async () => actions()[1].click())
        await act(async () => vi.dynamicImportSettled())
        for (let i = 0; i < 5; i++) await settle()

        const dialog = () => document.body.querySelector('[role="dialog"]')
        expect(dialog()?.textContent).toContain("Generate output to annotate")
        await run()

        const result = bodyOf("/evaluations/results/") as {results: {scenario_id: string}[]}
        expect(result.results[0].scenario_id).toBe("sc-2")
        expect(dialog()?.textContent).not.toContain("Generate output to annotate")
        expect(dialog()?.textContent).toContain("Annotate")
    })
})
