import {evaluationRunQueryKey, runLevelMetricsQueryKey} from "@agenta/entities/evaluationRun"
import {projectIdAtom} from "@agenta/shared/state"
import {getDefaultStore} from "jotai"
import {queryClientAtom} from "jotai-tanstack-query"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

const http = vi.hoisted(() => ({get: vi.fn(), post: vi.fn(), patch: vi.fn()}))

vi.mock("@agenta/shared/api", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@agenta/shared/api")>()),
    axios: http,
    getAgentaApiUrl: () => "https://agenta.test/api",
}))

import {runScenarioInvocation} from "../../src/state/evaluationRunInvocation"

const PROJECT = "project-1"
const RUN = "run-1"
const SCENARIO = "scenario-1"
const STEP = "application-3b8c"
const APP = "01a20000-0000-7000-8000-00000000a001"
const VARIANT = "01a20000-0000-7000-8000-00000000a002"
const REVISION = "01a20000-0000-7000-8000-00000000a003"
const TESTCASE = "01a20000-0000-7000-8000-00000000c001"
const INVOKE_URL = "https://svc.test/services/completion/v0/invoke?project_id=project-1"
const TRACE_HEX = "0123456789abcdef0123456789abcdef"
const SPAN_HEX = "0123456789abcdef"

const run = (invocationReferences: Record<string, {id: string}>, closed = false) => ({
    id: RUN,
    flags: {is_closed: closed},
    name: "Tickets",
    status: "running",
    data: {
        steps: [
            {
                key: "testset-91fe",
                type: "input",
                origin: "auto",
                references: {testset: {id: "01a20000-0000-7000-8000-00000000t001"}},
            },
            {
                key: STEP,
                type: "invocation",
                origin: "human",
                references: invocationReferences,
            },
            {
                key: `${STEP}.tone`,
                type: "annotation",
                origin: "human",
                references: {evaluator: {id: "01a20000-0000-7000-8000-00000000h001"}},
            },
        ],
        mappings: [],
    },
})

const fullReferences = {
    application: {id: APP},
    application_variant: {id: VARIANT},
    application_revision: {id: REVISION},
}

const revision = {
    id: REVISION,
    slug: "support-bot-v1",
    version: 1,
    workflow_id: APP,
    workflow_variant_id: VARIANT,
    flags: {is_chat: false},
    data: {
        uri: "agenta:custom:completion:v0",
        url: "https://svc.test/services/completion/v0",
        parameters: {temperature: 0},
    },
}

const store = getDefaultStore()
const client = store.get(queryClientAtom)

/** Serve the API: the run, its step results, the test case and the revision. */
function serveApi(invocationStatus?: string) {
    http.get.mockImplementation(async (url: string) => {
        if (url === `https://agenta.test/api/workflows/revisions/${REVISION}`) {
            return {data: {count: 1, workflow_revision: revision}}
        }
        throw new Error(`unexpected GET ${url}`)
    })
    http.post.mockImplementation(async (url: string) => {
        if (url.endsWith("/evaluations/results/query")) {
            return {
                data: {
                    count: 2,
                    results: [
                        {
                            id: "result-input",
                            run_id: RUN,
                            scenario_id: SCENARIO,
                            step_key: "testset-91fe",
                            status: "success",
                            testcase_id: TESTCASE,
                        },
                        {
                            id: "result-invocation",
                            run_id: RUN,
                            scenario_id: SCENARIO,
                            step_key: STEP,
                            ...(invocationStatus ? {status: invocationStatus} : {}),
                        },
                    ],
                },
            }
        }
        if (url.endsWith("/testcases/query")) {
            return {data: {count: 1, testcases: [{id: TESTCASE, data: {country: "France"}}]}}
        }
        return {data: {}}
    })
    http.patch.mockResolvedValue({data: {}})
}

const fetchMock = vi.fn()

beforeEach(() => {
    client.clear()
    store.set(projectIdAtom, PROJECT)
    http.get.mockReset()
    http.post.mockReset()
    http.patch.mockReset()
    fetchMock.mockReset()
    vi.stubGlobal("fetch", fetchMock)
    serveApi()
    client.setQueryData(evaluationRunQueryKey(RUN), run(fullReferences))
})

afterEach(() => {
    vi.unstubAllGlobals()
})

const appAnswers = (status: number, body: unknown) =>
    fetchMock.mockResolvedValue(
        new Response(JSON.stringify(body), {
            status,
            headers: {"Content-Type": "application/json"},
        }),
    )

/** The posts sent to one path, by their body. */
const postsTo = (path: string) =>
    http.post.mock.calls.filter(([url]) => String(url).endsWith(path)).map(([, body]) => body)

const params = {projectId: PROJECT, runId: RUN, scenarioId: SCENARIO, stepKey: STEP}

describe("runScenarioInvocation", () => {
    it("A successful run upserts the step result with the trace and span ids", async () => {
        appAnswers(200, {data: "Paris", trace_id: TRACE_HEX, span_id: SPAN_HEX})
        client.setQueryData(["scenarioSteps", RUN, SCENARIO], [])
        client.setQueryData(runLevelMetricsQueryKey(PROJECT, RUN), [])

        const result = await runScenarioInvocation(params)

        expect(result).toEqual({ok: true})
        // The app gets the test case of the scenario as its inputs.
        expect(fetchMock).toHaveBeenCalledOnce()
        const [invokeUrl, init] = fetchMock.mock.calls[0]
        expect(invokeUrl).toBe(INVOKE_URL)
        expect(JSON.parse(init.body).data.inputs).toEqual({country: "France"})
        expect(postsTo("/testcases/query")).toEqual([{testcase_ids: [TESTCASE]}])

        expect(postsTo("/evaluations/results/")).toEqual([
            {
                results: [
                    {
                        run_id: RUN,
                        scenario_id: SCENARIO,
                        step_key: STEP,
                        status: "success",
                        trace_id: "01234567-89ab-cdef-0123-456789abcdef",
                        span_id: "01234567-89ab-cdef-0123-456789abcdef",
                        references: fullReferences,
                        outputs: "Paris",
                    },
                ],
            },
        ])
        expect(http.patch).not.toHaveBeenCalled()
        // The scenario metrics, then the run metrics are computed again.
        expect(postsTo("/evaluations/metrics/refresh")).toEqual([
            {metrics: {run_id: RUN, scenario_id: SCENARIO}},
            {metrics: {run_id: RUN}},
        ])
        // What the screen reads about this scenario is read again.
        expect(client.getQueryState(["scenarioSteps", RUN, SCENARIO])?.isInvalidated).toBe(true)
        expect(client.getQueryState(runLevelMetricsQueryKey(PROJECT, RUN))?.isInvalidated).toBe(
            true,
        )
    })

    it("A failed run stores the failure and marks the scenario failed", async () => {
        appAnswers(500, {detail: "The model refused", trace_id: TRACE_HEX})

        const result = await runScenarioInvocation(params)

        expect(result).toEqual({
            ok: false,
            reason: "invocation-failed",
            detail: "The model refused",
        })
        expect(postsTo("/evaluations/results/")).toEqual([
            {
                results: [
                    {
                        run_id: RUN,
                        scenario_id: SCENARIO,
                        step_key: STEP,
                        status: "failure",
                        trace_id: "01234567-89ab-cdef-0123-456789abcdef",
                        references: fullReferences,
                        error: {message: "The model refused"},
                    },
                ],
            },
        ])
        expect(http.patch).toHaveBeenCalledOnce()
        expect(http.patch).toHaveBeenCalledWith(
            "https://agenta.test/api/evaluations/scenarios/",
            {scenarios: [{id: SCENARIO, status: "failure"}]},
            {params: {project_id: PROJECT}},
        )
    })

    it("A second call for the same scenario while one runs sends no request", async () => {
        let answer!: (response: Response) => void
        fetchMock.mockReturnValue(new Promise<Response>((resolve) => (answer = resolve)))

        const first = runScenarioInvocation(params)
        await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce())
        const requestsBefore = http.get.mock.calls.length + http.post.mock.calls.length

        const second = runScenarioInvocation(params)

        expect(http.get.mock.calls.length + http.post.mock.calls.length).toBe(requestsBefore)
        answer(
            new Response(JSON.stringify({data: "Paris", trace_id: TRACE_HEX}), {
                status: 200,
                headers: {"Content-Type": "application/json"},
            }),
        )
        expect(await first).toEqual({ok: true})
        expect(await second).toEqual({ok: true})
        expect(fetchMock).toHaveBeenCalledOnce()
        expect(postsTo("/evaluations/results/")).toHaveLength(1)
    })

    it("A run without an application reference returns missing-reference and sends nothing", async () => {
        client.setQueryData(evaluationRunQueryKey(RUN), run({application_revision: {id: REVISION}}))

        const result = await runScenarioInvocation(params)

        expect(result).toMatchObject({ok: false, reason: "missing-reference"})
        expect(http.get).not.toHaveBeenCalled()
        expect(http.post).not.toHaveBeenCalled()
        expect(http.patch).not.toHaveBeenCalled()
        expect(fetchMock).not.toHaveBeenCalled()
    })

    it("A failed request returns request-failed and does not call the app", async () => {
        http.get.mockRejectedValue(new Error("Network Error"))

        const result = await runScenarioInvocation(params)

        expect(result).toEqual({ok: false, reason: "request-failed", detail: "Network Error"})
        expect(fetchMock).not.toHaveBeenCalled()
        expect(postsTo("/evaluations/results/")).toEqual([])
    })

    it("A successful run after a failed one sets the scenario back to pending", async () => {
        serveApi("failure")
        appAnswers(200, {data: "Paris", trace_id: TRACE_HEX})

        expect(await runScenarioInvocation(params)).toEqual({ok: true})

        expect(http.patch).toHaveBeenCalledOnce()
        expect(http.patch).toHaveBeenCalledWith(
            "https://agenta.test/api/evaluations/scenarios/",
            {scenarios: [{id: SCENARIO, status: "pending"}]},
            {params: {project_id: PROJECT}},
        )
    })

    it("When the status reset fails, the success is not stored and Run stays", async () => {
        serveApi("failure")
        http.patch.mockRejectedValue(new Error("Network Error"))
        appAnswers(200, {data: "Paris", trace_id: TRACE_HEX})

        const result = await runScenarioInvocation(params)

        expect(result).toEqual({ok: false, reason: "request-failed", detail: "Network Error"})
        // The stored result stays failed, so the screen still offers Run again.
        expect(postsTo("/evaluations/results/")).toEqual([])
    })

    it("A closed run returns run-closed and does not call the app", async () => {
        client.setQueryData(evaluationRunQueryKey(RUN), run(fullReferences, true))

        const result = await runScenarioInvocation(params)

        expect(result).toMatchObject({ok: false, reason: "run-closed"})
        expect(fetchMock).not.toHaveBeenCalled()
        expect(http.get).not.toHaveBeenCalled()
        expect(http.post).not.toHaveBeenCalled()
    })
})
