/**
 * Annotating inside an evaluation run, without a queue. The session and form controllers, the
 * run molecule and the annotation API functions are the real ones; only the HTTP client and the
 * host query client are replaced, so the asserted bodies are what the API receives.
 */
import {annotationFormController, annotationSessionController} from "@agenta/annotation"
import {projectIdAtom, sessionAtom} from "@agenta/shared/state"
import {QueryClient} from "@tanstack/react-query"
import {getDefaultStore} from "jotai"
import {queryClientAtom} from "jotai-tanstack-query"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

const http = vi.hoisted(() => ({
    post: vi.fn(),
    patch: vi.fn(),
    get: vi.fn(),
    client: null as unknown,
}))

vi.mock("@agenta/shared/api", async (importOriginal) => {
    const actual = await importOriginal<typeof import("@agenta/shared/api")>()
    return {
        ...actual,
        getAgentaApiUrl: () => "http://api.test",
        getHostQueryClient: () => http.client,
        axios: {...actual.axios, post: http.post, patch: http.patch, get: http.get},
    }
})

const PROJECT = "project-1"
const RUN = "run-1"
const SCENARIO = "sc-1"
const store = getDefaultStore()
/** Results the API lists before the app result of the scenario. */
let earlierResults: Record<string, unknown>[] = []

const RUN_BODY = {
    id: RUN,
    name: "Tone review",
    status: "running",
    data: {
        steps: [
            {key: "ts", type: "input", references: {testset: {id: "ts-1"}}},
            {key: "app", type: "invocation", references: {application: {id: "app-1"}}},
            {
                key: "app.quality",
                type: "annotation",
                origin: "human",
                references: {evaluator: {id: "wf-quality", slug: "quality"}},
            },
        ],
        mappings: [],
    },
}

const QUALITY = {
    id: "rev-quality",
    workflow_id: "wf-quality",
    slug: "quality",
    name: "Quality",
    description: "Is the reply good",
    flags: {is_evaluator: true, is_feedback: true},
    data: {
        schemas: {outputs: {type: "object", properties: {good: {type: "boolean"}}}},
    },
}

const writes = () =>
    [...http.post.mock.calls, ...http.patch.mock.calls]
        .map(([url, body]) => ({url: String(url), body}))
        .filter(({url}) => !url.endsWith("/query"))

const bodyOf = (url: string) => writes().find((call) => call.url === url)?.body

beforeEach(() => {
    earlierResults = []
    http.post.mockReset()
    http.patch.mockReset()
    http.get.mockReset()
    const client = new QueryClient({defaultOptions: {queries: {retry: false}}})
    http.client = client
    client.setQueryData(["workflows", "latestRevision", "wf-quality", PROJECT], QUALITY)
    store.set(queryClientAtom, client)
    store.set(projectIdAtom, PROJECT)
    store.set(sessionAtom, true)
    http.post.mockImplementation(async (url: string) => {
        if (url.endsWith("/evaluations/runs/query")) return {data: {count: 1, runs: [RUN_BODY]}}
        if (url.endsWith("/evaluations/results/query")) {
            return {
                data: {
                    count: 2,
                    results: [
                        ...earlierResults,
                        {run_id: RUN, scenario_id: SCENARIO, step_key: "ts", testcase_id: "tc-1"},
                        {
                            run_id: RUN,
                            scenario_id: SCENARIO,
                            step_key: "app",
                            trace_id: "trace-1",
                            span_id: "span-1",
                            status: "success",
                        },
                    ],
                },
            }
        }
        if (url.endsWith("/evaluations/scenarios/query")) {
            return {data: {scenarios: [{id: SCENARIO, status: "success"}]}}
        }
        if (url.endsWith("/simple/traces/")) {
            return {
                data: {trace: {trace_id: "ann-1", span_id: "ann-span-1", data: {outputs: {}}}},
            }
        }
        return {data: {}}
    })
    http.patch.mockResolvedValue({data: {}})
})

afterEach(() => {
    annotationSessionController.set.closeSession()
})

/** Open the run and wait until its evaluator is resolved, as a mounted form would. */
async function openRunForm() {
    annotationSessionController.set.openRun({runId: RUN})
    const stop = store.sub(annotationFormController.selectors.evaluators(SCENARIO), () => undefined)
    await vi.waitFor(() =>
        expect(annotationFormController.get.evaluators(SCENARIO)).toHaveLength(1),
    )
    stop()
    annotationFormController.set.setScenarioContext({
        scenarioId: SCENARIO,
        annotations: [],
        traceId: "trace-1",
        spanId: "span-1",
        testcaseId: "tc-1",
    })
    annotationFormController.set.updateMetric({
        scenarioId: SCENARIO,
        slug: "quality",
        fieldKey: "good",
        value: true,
    })
}

describe("annotation in run scope", () => {
    it("Opening a run makes its run id the active run without a queue", () => {
        annotationSessionController.set.openRun({runId: RUN})
        expect(store.get(annotationSessionController.selectors.activeRunId())).toBe(RUN)
        expect(store.get(annotationSessionController.selectors.activeQueueId())).toBeNull()
    })

    it("Closing the session clears the run scope", () => {
        annotationSessionController.set.openRun({runId: RUN})
        annotationSessionController.set.closeSession()
        expect(store.get(annotationSessionController.selectors.activeRunId())).toBeNull()
    })

    it("Submitting in run scope creates a human annotation with evaluator, test set and test case references and the invocation link", async () => {
        await openRunForm()
        await annotationFormController.set.submitAnnotations({
            scenarioId: SCENARIO,
            markComplete: true,
        })

        expect(bodyOf("http://api.test/simple/traces/")).toEqual({
            trace: {
                data: {outputs: {good: true}},
                references: {
                    evaluator: {id: "wf-quality", slug: "quality"},
                    testset: {id: "ts-1"},
                    testcase: {id: "tc-1"},
                },
                links: {app: {trace_id: "trace-1", span_id: "span-1"}},
                origin: "human",
                kind: "adhoc",
                channel: "web",
                meta: {name: "Quality", description: "Is the reply good", tags: ["good"]},
            },
        })
    })

    it("Submitting in run scope upserts the annotation step result and the scenario metrics", async () => {
        await openRunForm()
        await annotationFormController.set.submitAnnotations({
            scenarioId: SCENARIO,
            markComplete: true,
        })
        await vi.waitFor(() => expect(bodyOf("http://api.test/evaluations/metrics/")).toBeDefined())

        expect(bodyOf("http://api.test/evaluations/results/")).toEqual({
            results: [
                {
                    run_id: RUN,
                    scenario_id: SCENARIO,
                    step_key: "app.quality",
                    status: "success",
                    trace_id: "ann-1",
                    span_id: "ann-span-1",
                },
            ],
        })
        expect(bodyOf("http://api.test/evaluations/metrics/")).toEqual({
            metrics: [
                {
                    run_id: RUN,
                    scenario_id: SCENARIO,
                    status: "success",
                    data: {
                        "app.quality": {
                            "attributes.ag.data.outputs.good": {
                                type: "binary",
                                count: 1,
                                freq: [
                                    {value: true, count: 1, density: 1},
                                    {value: false, count: 0, density: 0},
                                ],
                                uniq: [true, false],
                            },
                        },
                    },
                },
            ],
        })
        expect(bodyOf("http://api.test/evaluations/scenarios/")).toEqual({
            scenarios: [{id: SCENARIO, status: "success"}],
        })
    })

    it("An annotation result listed before the app result is not taken for the app output", async () => {
        // Another evaluator of the run already annotated this scenario, and the API lists that
        // annotation's result first.
        RUN_BODY.data.steps.push({
            key: "app.tone",
            type: "annotation",
            origin: "human",
            references: {evaluator: {id: "wf-tone", slug: "tone"}},
        })
        earlierResults = [
            {
                run_id: RUN,
                scenario_id: SCENARIO,
                step_key: "app.tone",
                trace_id: "ann-tone",
                span_id: "ann-span-tone",
                status: "success",
            },
        ]
        try {
            annotationSessionController.set.openRun({runId: RUN})
            const traceRef = annotationSessionController.selectors.scenarioTraceRef(SCENARIO)
            const stop = store.sub(traceRef, () => undefined)
            await vi.waitFor(() =>
                expect(store.get(traceRef)).toEqual({traceId: "trace-1", spanId: "span-1"}),
            )
            stop()

            await openRunForm()
            await annotationFormController.set.submitAnnotations({
                scenarioId: SCENARIO,
                markComplete: true,
            })
            const created = bodyOf("http://api.test/simple/traces/") as {trace: {links: unknown}}
            expect(created.trace.links).toEqual({app: {trace_id: "trace-1", span_id: "span-1"}})
            const stepResult = bodyOf("http://api.test/evaluations/results/") as {
                results: {step_key: string}[]
            }
            expect(stepResult.results.map((result) => result.step_key)).toEqual(["app.quality"])
        } finally {
            RUN_BODY.data.steps.pop()
        }
    })

    it("A failed create sets the submit error and sends no step result", async () => {
        await openRunForm()
        http.post.mockImplementation(async (url: string) => {
            if (url.endsWith("/simple/traces/")) throw new Error("Request failed with 500")
            return {data: {}}
        })
        await expect(
            annotationFormController.set.submitAnnotations({
                scenarioId: SCENARIO,
                markComplete: true,
            }),
        ).rejects.toThrow()
        expect(annotationFormController.get.submitError(SCENARIO)).toBeTruthy()
        expect(bodyOf("http://api.test/evaluations/results/")).toBeUndefined()
        // The value the reader entered is still in the form.
        expect(annotationFormController.get.effectiveMetrics(SCENARIO).quality.good.value).toBe(
            true,
        )
    })
})
