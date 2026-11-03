// @vitest-environment jsdom
import {act, createElement} from "react"

import {projectIdAtom, sessionAtom} from "@agenta/shared/state"
import {QueryClient, QueryClientProvider} from "@tanstack/react-query"
import {getDefaultStore} from "jotai"
import {queryClientAtom} from "jotai-tanstack-query"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

import {
    createInitialDraft,
    newEvaluationReducer,
    type DraftEvaluator,
    type NewEvaluationAction,
    type NewEvaluationDraft,
    type NewEvaluationKind,
} from "@/features/evaluations/new/newEvaluationDraft"
import {
    useStartEvaluation,
    type StartEvaluationResult,
} from "@/features/evaluations/new/useStartEvaluation"

// Only the HTTP layer is mocked. The run builders, the workflow stores and the vault store are real.
const http = vi.hoisted(() => ({post: vi.fn(), get: vi.fn(), delete: vi.fn()}))
const toast = vi.hoisted(() => ({
    message: {success: vi.fn(), error: vi.fn(), warning: vi.fn()},
    notification: {error: vi.fn()},
}))
const nav = vi.hoisted(() => ({push: vi.fn()}))

vi.mock("@agenta/shared/api", async (original) => ({
    ...(await original<object>()),
    axios: http,
    getAgentaApiUrl: () => "https://api.test",
}))
vi.mock("@agenta/ui/app-message", () => toast)
vi.mock("next/router", () => ({useRouter: () => ({push: nav.push, query: {}})}))
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT =
    true

const API = "https://api.test"
const PARAMS = {params: {project_id: "pr"}}
const ID = {
    app: "11111111-1111-4111-8111-111111111111",
    revisionA: "22222222-2222-4222-8222-22222222aaaa",
    revisionB: "22222222-2222-4222-8222-22222222bbbb",
    variant: "33333333-3333-4333-8333-333333333333",
    testset: "44444444-4444-4444-8444-444444444444",
    testsetRevision: "55555555-5555-4555-8555-555555555555",
    evaluator: "66666666-6666-4666-8666-666666666666",
    evaluatorRevision: "77777777-7777-4777-8777-777777777777",
    evaluatorVariant: "88888888-8888-4888-8888-888888888888",
} as const

const evaluatorPick: DraftEvaluator = {
    revisionId: ID.evaluatorRevision,
    evaluatorId: ID.evaluator,
    name: "Exact match",
    version: 2,
    isHuman: false,
}

let host: HTMLDivElement
let root: Root
let client: QueryClient
let api: ReturnType<typeof useStartEvaluation>

const Probe = () => {
    api = useStartEvaluation({projectId: "pr", base: "/w/ws/p/pr"})
    return null
}

const seedWorkflows = (evaluatorFlags: Record<string, boolean> = {}) => {
    client.setQueryData(["workflows", "revision", ID.revisionA, "pr"], {
        id: ID.revisionA,
        workflow_id: ID.app,
        workflow_variant_id: ID.variant,
        data: {
            schemas: {
                inputs: {type: "object", properties: {country: {type: "string"}}},
            },
        },
    })
    client.setQueryData(["workflows", "revision", ID.evaluatorRevision, "pr"], {
        id: ID.evaluatorRevision,
        workflow_id: ID.evaluator,
        workflow_variant_id: ID.evaluatorVariant,
        flags: {is_evaluator: true, ...evaluatorFlags},
        data: {
            uri: "agenta:builtin:exact_match:v0",
            schemas: {
                outputs: {
                    type: "object",
                    properties: {score: {type: "number"}, note: {type: "string"}},
                },
            },
        },
    })
    client.setQueryData(["workflows", "artifact", ID.evaluator, "pr"], {
        id: ID.evaluator,
        slug: "exact-match",
        name: "Exact match",
    })
}

/** The API answers like the real one for the endpoints the run builders call. */
const mockApi = (overrides: Record<string, (body: unknown) => unknown> = {}) => {
    let runCounter = 0
    http.post.mockImplementation(async (url: string, body: unknown) => {
        const path = url.replace(API, "")
        const override = overrides[path]
        if (override) return {data: override(body)}
        switch (path) {
            case "/simple/evaluations/":
                runCounter += 1
                return {data: {evaluation: {id: `auto-run-${runCounter}`}}}
            case "/testcases/query":
                return {
                    data: {
                        count: 2,
                        testcases: [
                            {id: "tc-1", data: {country: "France", correct_answer: "Paris"}},
                            {id: "tc-2", data: {country: "Japan", correct_answer: "Tokyo"}},
                        ],
                        windowing: {next: null},
                    },
                }
            case "/evaluations/runs/":
                return {data: {runs: [{id: "human-run"}]}}
            case "/evaluations/scenarios/": {
                const {scenarios} = body as {scenarios: unknown[]}
                return {data: {scenarios: scenarios.map((_, index) => ({id: `sc-${index}`}))}}
            }
            case "/evaluations/results/": {
                const {results} = body as {results: unknown[]}
                return {data: {results}}
            }
            default:
                throw new Error(`Unexpected request: ${path}`)
        }
    })
    http.get.mockResolvedValue({data: []})
}

const build = (kind: NewEvaluationKind, ...actions: NewEvaluationAction[]): NewEvaluationDraft =>
    actions.reduce(newEvaluationReducer, createInitialDraft(kind, {suffix: "abc12"}))

const filled = (kind: NewEvaluationKind, extra: NewEvaluationAction[] = []) =>
    build(
        kind,
        {type: "pickApp", app: {id: ID.app, name: "Support bot", isCustom: false}},
        {
            type: "pickRevision",
            revision: {id: ID.revisionA, variantName: "default", version: 3},
        },
        ...(kind === "auto"
            ? [
                  {
                      type: "pickRevision",
                      revision: {id: ID.revisionB, variantName: "concise", version: 1},
                  } as NewEvaluationAction,
              ]
            : []),
        {
            type: "pickTestset",
            testset: {
                revisionId: ID.testsetRevision,
                testsetId: ID.testset,
                name: "greetings",
                version: 2,
            },
        },
        {type: "pickEvaluator", evaluator: evaluatorPick},
        {type: "setName", name: "Weekly check"},
        ...extra,
    )

const startWith = async (draft: NewEvaluationDraft) => {
    let result: StartEvaluationResult | undefined
    await act(async () => {
        result = await api.start(draft)
    })
    return result as StartEvaluationResult
}

const requests = (path: string) =>
    http.post.mock.calls.filter(([url]) => url === `${API}${path}`).map(([, body]) => body)

beforeEach(async () => {
    vi.clearAllMocks()
    client = new QueryClient({defaultOptions: {queries: {retry: false}}})
    const store = getDefaultStore()
    store.set(queryClientAtom, client)
    store.set(projectIdAtom, "pr")
    store.set(sessionAtom, true)
    host = document.createElement("div")
    document.body.appendChild(host)
    root = createRoot(host)
    seedWorkflows()
    mockApi()
    await act(async () =>
        root.render(createElement(QueryClientProvider, {client}, createElement(Probe))),
    )
})

afterEach(() => {
    act(() => root.unmount())
    host.remove()
})

describe("starting an auto evaluation", () => {
    it("Auto start posts one simple evaluation per revision with the picked test set revision and evaluators", async () => {
        const result = await startWith(filled("auto"))

        expect(result).toEqual({status: "started", kind: "auto"})
        const evaluation = (revisionId: string) => ({
            evaluation: {
                name: "Weekly check",
                data: {
                    testset_steps: {[ID.testsetRevision]: "auto"},
                    application_steps: {[revisionId]: "auto"},
                    evaluator_steps: {[ID.evaluatorRevision]: "auto"},
                    concurrency: {batch_size: 10, max_retries: 3, retry_delay: 3},
                },
                flags: {is_live: false, is_active: true, is_closed: false},
            },
        })
        expect(requests("/simple/evaluations/")).toEqual([
            evaluation(ID.revisionA),
            evaluation(ID.revisionB),
        ])
        expect(http.post).toHaveBeenCalledWith(
            `${API}/simple/evaluations/`,
            expect.anything(),
            PARAMS,
        )
    })

    it("Auto start sends the edited concurrency settings", async () => {
        await startWith(
            filled("auto", [
                {type: "setConcurrency", field: "batch_size", value: 4},
                {type: "setConcurrency", field: "max_retries", value: 0},
                {type: "setConcurrency", field: "retry_delay", value: 9},
            ]),
        )
        const [first] = requests("/simple/evaluations/") as {
            evaluation: {data: {concurrency: unknown}}
        }[]
        expect(first.evaluation.data.concurrency).toEqual({
            batch_size: 4,
            max_retries: 0,
            retry_delay: 9,
        })
    })

    it("Auto success shows Evaluation started with View progress to the first run", async () => {
        const draft = filled("auto")
        const single = {...draft, revisions: [draft.revisions[0]]}
        await startWith(single)

        const [options] = toast.message.success.mock.calls[0]
        expect(options).toMatchObject({content: "Evaluation started.", linkText: "View progress"})
        options.onNavigate()
        expect(nav.push).toHaveBeenCalledWith("/w/ws/p/pr/evaluations/results/auto-run-1")
    })

    it("Two of three runs started shows 2 of 3 evaluations started", async () => {
        const draft = filled("auto", [
            {
                type: "pickRevision",
                revision: {
                    id: "22222222-2222-4222-8222-22222222cccc",
                    variantName: "terse",
                    version: 2,
                },
            },
        ])
        http.post.mockImplementationOnce(async () => ({data: {evaluation: {id: "auto-run-1"}}}))
        http.post.mockImplementationOnce(async () => {
            throw new Error("boom")
        })
        http.post.mockImplementationOnce(async () => ({data: {evaluation: {id: "auto-run-3"}}}))

        const result = await startWith(draft)

        expect(http.post).toHaveBeenCalledTimes(3)
        expect(result).toEqual({status: "started", kind: "auto"})
        const [options] = toast.message.warning.mock.calls[0]
        expect(options).toMatchObject({
            content: "2 of 3 evaluations started",
            linkText: "View progress",
        })
    })

    it("A failed auto start shows Couldn't start the evaluation and keeps the sheet open", async () => {
        http.post.mockRejectedValue(new Error("server down"))
        vi.spyOn(console, "error").mockImplementation(() => undefined)

        const result = await startWith(filled("auto"))

        expect(result).toEqual({status: "failed"})
        expect(toast.message.error).toHaveBeenCalledWith("Couldn't start the evaluation")
        expect(toast.message.success).not.toHaveBeenCalled()
        expect(nav.push).not.toHaveBeenCalled()
    })

    it("A second click while starting sends nothing", async () => {
        let release: (value: unknown) => void = () => undefined
        http.post.mockImplementation(() => new Promise((resolve) => (release = resolve)))
        const draft = filled("auto")
        const single = {...draft, revisions: [draft.revisions[0]]}

        let first: Promise<StartEvaluationResult> | undefined
        let second: StartEvaluationResult | undefined
        await act(async () => {
            first = api.start(single)
            second = await api.start(single)
        })

        expect(second).toEqual({status: "busy"})
        expect(http.post).toHaveBeenCalledTimes(1)
        await act(async () => {
            release({data: {evaluation: {id: "auto-run-1"}}})
            await first
        })
    })

    it("An invalid draft shows the first problem and opens its section", async () => {
        const result = await startWith({...filled("auto"), name: ""})
        expect(result).toMatchObject({status: "invalid"})
        expect(toast.message.error).toHaveBeenCalledWith("Please enter evaluation name")
        expect(http.post).not.toHaveBeenCalled()
    })

    it("An AI critique evaluator in a project with no LLM key shows LLM Key Missing and opens the LLM settings tab", async () => {
        seedWorkflows({is_llm: true})
        const draft = filled("auto")

        const result = await startWith({...draft, revisions: [draft.revisions[0]]})

        expect(result).toEqual({status: "blocked"})
        expect(toast.notification.error).toHaveBeenCalledWith({
            message: "LLM Key Missing",
            description: "Please provide at least one LLM key to access this feature.",
        })
        expect(toast.message.error).toHaveBeenCalledWith(
            "LLM keys are required for AI Critique configuration",
        )
        expect(nav.push).toHaveBeenCalledWith("/w/ws/p/pr/settings?tab=llms")
        expect(requests("/simple/evaluations/")).toEqual([])
    })
})

describe("starting a human evaluation", () => {
    const inputKey = "greetings-444444444444"
    const invocationKey = "default-22222222aaaa"
    const annotationKey = `${invocationKey}.exact-match`

    it("Human start posts the run with one annotation step per evaluator slug", async () => {
        const result = await startWith(filled("human"))

        expect(result).toEqual({status: "started", kind: "human"})
        expect(http.post).toHaveBeenCalledWith(
            `${API}/evaluations/runs/`,
            {
                runs: [
                    {
                        key: `evaluation-${ID.variant}`,
                        name: "Weekly check",
                        meta: {evaluation_kind: "human"},
                        data: {
                            steps: [
                                {
                                    key: inputKey,
                                    type: "input",
                                    origin: "auto",
                                    references: {
                                        testset: {id: ID.testset},
                                        testset_revision: {id: ID.testsetRevision},
                                    },
                                },
                                {
                                    key: invocationKey,
                                    type: "invocation",
                                    origin: "human",
                                    references: {
                                        application: {id: ID.app},
                                        application_variant: {id: ID.variant},
                                        application_revision: {id: ID.revisionA},
                                    },
                                    inputs: [{key: inputKey}],
                                },
                                {
                                    key: annotationKey,
                                    type: "annotation",
                                    origin: "human",
                                    references: {
                                        evaluator: {id: ID.evaluator},
                                        evaluator_variant: {id: ID.evaluatorVariant},
                                        evaluator_revision: {id: ID.evaluatorRevision},
                                    },
                                    inputs: [{key: inputKey}, {key: invocationKey}],
                                },
                            ],
                            mappings: [
                                {
                                    column: {kind: "testset", name: "country"},
                                    step: {key: inputKey, path: "data.country"},
                                },
                                {
                                    column: {kind: "invocation", name: "outputs"},
                                    step: {key: invocationKey, path: "attributes.ag.data.outputs"},
                                },
                                {
                                    column: {kind: "evaluator", name: "exact-match.score"},
                                    step: {key: annotationKey, path: "data.outputs.score"},
                                },
                                {
                                    column: {kind: "evaluator", name: "exact-match.note"},
                                    step: {key: annotationKey, path: "data.outputs.note"},
                                },
                            ],
                        },
                    },
                ],
            },
            PARAMS,
        )
        expect(JSON.stringify(requests("/evaluations/runs/"))).not.toContain("undefined")
    })

    it("Human start posts one scenario per testcase and seeds input, invocation and annotation results", async () => {
        await startWith(filled("human"))

        expect(requests("/evaluations/scenarios/")).toEqual([
            {scenarios: [{run_id: "human-run"}, {run_id: "human-run"}]},
        ])
        const base = (testcase: string, scenario: string) => ({
            testcase_id: testcase,
            scenario_id: scenario,
            run_id: "human-run",
        })
        expect(requests("/evaluations/results/")).toEqual([
            {
                results: [
                    {...base("tc-1", "sc-0"), status: "success", step_key: inputKey},
                    {...base("tc-1", "sc-0"), step_key: invocationKey},
                    {...base("tc-1", "sc-0"), step_key: annotationKey},
                    {...base("tc-2", "sc-1"), status: "success", step_key: inputKey},
                    {...base("tc-2", "sc-1"), step_key: invocationKey},
                    {...base("tc-2", "sc-1"), step_key: annotationKey},
                ],
            },
        ])
    })

    it("Human success opens the run on the Annotate view", async () => {
        await startWith(filled("human"))
        expect(nav.push).toHaveBeenCalledWith("/w/ws/p/pr/evaluations/results/human-run?view=focus")
        expect(toast.message.success).not.toHaveBeenCalled()
    })

    it("A human start that fails shows Couldn't start the evaluation and keeps the sheet open", async () => {
        mockApi({
            "/evaluations/scenarios/": () => {
                throw new Error("scenarios failed")
            },
        })
        http.delete.mockResolvedValue({data: {}})
        vi.spyOn(console, "error").mockImplementation(() => undefined)

        const result = await startWith(filled("human"))

        expect(result).toEqual({status: "failed"})
        expect(toast.message.error).toHaveBeenCalledWith("Couldn't start the evaluation")
        expect(nav.push).not.toHaveBeenCalled()
    })
})
