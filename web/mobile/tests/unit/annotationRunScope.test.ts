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

const runBody = (extraSteps: Record<string, unknown>[] = []) => ({
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
            ...extraSteps,
        ],
        mappings: [],
    },
})
/** Annotation steps the run has besides Quality. */
let extraSteps: Record<string, unknown>[] = []

const QUALITY = {
    id: "rev-quality",
    workflow_id: "wf-quality",
    slug: "quality",
    name: "Quality",
    description: "Is the reply good",
    flags: {is_evaluator: true, is_feedback: true},
    data: {
        // Optional fields the tests leave untouched: a text, a single choice with a "none of the
        // above" null option, and a number.
        schemas: {
            outputs: {
                type: "object",
                properties: {
                    good: {type: "boolean"},
                    note: {type: "string"},
                    tone: {type: ["string", "null"], enum: ["warm", "cold", null]},
                    clarity: {type: "integer", minimum: 1, maximum: 5},
                },
            },
        },
    },
}

const writes = () =>
    [...http.post.mock.calls, ...http.patch.mock.calls]
        .map(([url, body]) => ({url: String(url), body}))
        .filter(({url}) => !url.endsWith("/query"))

const bodyOf = (url: string) => writes().find((call) => call.url === url)?.body

beforeEach(() => {
    earlierResults = []
    extraSteps = []
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
        if (url.endsWith("/evaluations/runs/query"))
            return {data: {count: 1, runs: [runBody(extraSteps)]}}
        if (url.endsWith("/evaluations/results/query")) {
            const results = [
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
            ]
            return {data: {count: results.length, results}}
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
    // The form keeps edits per scenario id, and every test uses the same one.
    annotationFormController.set.resetEdits(SCENARIO)
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

    it("An update sends the fields the user set and keeps a saved null answer", async () => {
        // The scenario already holds this user's Quality annotation, with "none of the above".
        const existing = {
            trace_id: "ann-1",
            span_id: "ann-span-1",
            data: {outputs: {good: true, note: "short", tone: null}},
            references: {evaluator: {id: "wf-quality", slug: "quality"}},
            links: {app: {trace_id: "trace-1", span_id: "span-1"}},
            origin: "human",
            kind: "adhoc",
            channel: "web",
            meta: {name: "Quality", description: "", tags: ["good", "note", "tone"]},
        }
        earlierResults = [
            {
                run_id: RUN,
                scenario_id: SCENARIO,
                step_key: "app.quality",
                trace_id: "ann-1",
                span_id: "ann-span-1",
                status: "success",
            },
        ]
        const answer = http.post.getMockImplementation()
        http.post.mockImplementation(async (url: string, ...rest: unknown[]) => {
            if (url.endsWith("/simple/traces/query")) {
                return {data: {count: 1, traces: [existing]}}
            }
            return answer?.(url, ...rest)
        })
        annotationSessionController.set.openRun({runId: RUN})
        const annotations = annotationSessionController.selectors.scenarioAnnotations(SCENARIO)
        const stop = store.sub(annotations, () => undefined)
        await vi.waitFor(() => expect(store.get(annotations)).toHaveLength(1))
        stop()
        const evaluators = annotationFormController.selectors.evaluators(SCENARIO)
        const stopEvaluators = store.sub(evaluators, () => undefined)
        await vi.waitFor(() => expect(store.get(evaluators)).toHaveLength(1))
        stopEvaluators()
        annotationFormController.set.setScenarioContext({
            scenarioId: SCENARIO,
            annotations: store.get(annotations),
            traceId: "trace-1",
            spanId: "span-1",
            testcaseId: "tc-1",
        })
        for (const [fieldKey, value] of [
            ["good", false],
            ["note", ""],
            ["clarity", 4],
        ] as const) {
            annotationFormController.set.updateMetric({
                scenarioId: SCENARIO,
                slug: "quality",
                fieldKey,
                value,
            })
        }
        await annotationFormController.set.submitAnnotations({
            scenarioId: SCENARIO,
            markComplete: true,
        })

        expect(bodyOf("http://api.test/simple/traces/")).toBeUndefined()
        const patched = bodyOf("http://api.test/simple/traces/ann-1") as {
            trace: {data: unknown}
        }
        expect(patched.trace.data).toEqual({outputs: {good: false, tone: null, clarity: 4}})
    })

    it("Submitting in run scope upserts the annotation step result and the scenario metrics", async () => {
        await openRunForm()
        await annotationFormController.set.submitAnnotations({
            scenarioId: SCENARIO,
            markComplete: true,
        })
        // A run save waits for its metric writes, so they are done here.

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
        extraSteps = [
            {
                key: "app.tone",
                type: "annotation",
                origin: "human",
                references: {evaluator: {id: "wf-tone", slug: "tone"}},
            },
        ]
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
    })

    it("A scenario without annotation results does not show another run's annotation of its test case", async () => {
        // Another run annotated the same test case with the same evaluator; a query by test case
        // would return that annotation.
        const answer = http.post.getMockImplementation()
        const otherRun = {
            trace_id: "ann-other-run",
            span_id: "ann-span-other-run",
            data: {outputs: {good: false}},
            references: {evaluator: {id: "wf-quality", slug: "quality"}, testcase: {id: "tc-1"}},
            origin: "human",
            kind: "adhoc",
            channel: "web",
        }
        http.post.mockImplementation(async (url: string, ...rest: unknown[]) => {
            if (url.endsWith("/simple/traces/query")) {
                return {data: {count: 1, traces: [otherRun]}}
            }
            return answer?.(url, ...rest)
        })
        annotationSessionController.set.openRun({runId: RUN})
        const annotations = annotationSessionController.selectors.scenarioAnnotations(SCENARIO)
        const stop = store.sub(annotations, () => undefined)
        const testcaseRef = annotationSessionController.selectors.scenarioTestcaseRef(SCENARIO)
        const stopRef = store.sub(testcaseRef, () => undefined)
        await vi.waitFor(() => expect(store.get(testcaseRef).testcaseId).toBe("tc-1"))
        await new Promise((resolve) => setTimeout(resolve, 50))
        stop()
        stopRef()

        expect(store.get(annotations)).toEqual([])
        const byTestcase = http.post.mock.calls.filter(
            ([url, body]) =>
                String(url).endsWith("/simple/traces/query") &&
                JSON.stringify(body).includes('"testcase"'),
        )
        expect(byTestcase).toEqual([])
    })

    it("A run save resolves only after the scenario metrics are written", async () => {
        await openRunForm()
        const answer = http.post.getMockImplementation()
        let finishMetrics: () => void = () => undefined
        http.post.mockImplementation(async (url: string, ...rest: unknown[]) => {
            if (url.endsWith("/evaluations/metrics/")) {
                await new Promise<void>((resolve) => {
                    finishMetrics = resolve
                })
            }
            return answer?.(url, ...rest)
        })
        let saved = false
        const save = annotationFormController.set
            .submitAnnotations({scenarioId: SCENARIO, markComplete: true})
            .then(() => {
                saved = true
            })
        await vi.waitFor(() => expect(bodyOf("http://api.test/evaluations/metrics/")).toBeDefined())
        await new Promise((resolve) => setTimeout(resolve, 20))
        expect(saved).toBe(false)
        finishMetrics()
        await save
        expect(saved).toBe(true)
    })

    it("A run save refreshes the scenario metrics, then the run metrics", async () => {
        await openRunForm()
        await annotationFormController.set.submitAnnotations({
            scenarioId: SCENARIO,
            markComplete: true,
        })
        const refreshes = writes().filter(({url}) => url.endsWith("/evaluations/metrics/refresh"))
        expect(refreshes.map(({body}) => body)).toEqual([
            {metrics: {run_id: RUN, scenario_id: SCENARIO}},
            {metrics: {run_id: RUN}},
        ])
    })

    it("A run save fails when the annotation cannot be linked to the scenario", async () => {
        await openRunForm()
        const answer = http.post.getMockImplementation()
        http.post.mockImplementation(async (url: string, ...rest: unknown[]) => {
            if (url.endsWith("/evaluations/results/")) throw new Error("Request failed with 500")
            return answer?.(url, ...rest)
        })
        await expect(
            annotationFormController.set.submitAnnotations({
                scenarioId: SCENARIO,
                markComplete: true,
            }),
        ).rejects.toThrow()
        expect(annotationFormController.get.submitError(SCENARIO)).toBeTruthy()
    })

    it("A failed create sets the submit error and sends no step result", async () => {
        await openRunForm()
        const answer = http.post.getMockImplementation()
        http.post.mockImplementation(async (url: string, ...rest: unknown[]) => {
            if (url.endsWith("/simple/traces/")) throw new Error("Request failed with 500")
            return answer?.(url, ...rest)
        })
        await expect(
            annotationFormController.set.submitAnnotations({
                scenarioId: SCENARIO,
                markComplete: true,
            }),
        ).rejects.toThrow("Request failed with 500")
        expect(http.post.mock.calls.map(([url]) => url)).toContain("http://api.test/simple/traces/")
        expect(annotationFormController.get.submitError(SCENARIO)).toBeTruthy()
        expect(bodyOf("http://api.test/evaluations/results/")).toBeUndefined()
        // The value the reader entered is still in the form.
        expect(annotationFormController.get.effectiveMetrics(SCENARIO).quality.good.value).toBe(
            true,
        )
    })
})
