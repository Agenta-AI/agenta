import {beforeEach, describe, expect, it, vi} from "vitest"

const {postMock, editSimpleEvaluation} = vi.hoisted(() => ({
    postMock: vi.fn(),
    editSimpleEvaluation: vi.fn(),
}))

vi.mock("@agenta/shared/api", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@agenta/shared/api")>()),
    axios: {post: postMock},
    getAgentaApiUrl: () => "https://agenta.test/api",
}))

// Only the Fern client is fake: the body builder and the response check are the real code.
vi.mock("@agenta/sdk/resources", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@agenta/sdk/resources")>()),
    getEvaluationsClient: () => ({editSimpleEvaluation}),
}))

import {
    buildRunEditBody,
    editEvaluationRun,
    evaluationRunSchema,
    humanizeMetricLabel,
    processNewEvaluatorSteps,
} from "../../src/evaluationRun"
import auto from "../fixtures/evaluationRun/auto-metrics.json"
import online from "../fixtures/evaluationRun/online-metrics.json"

const autoRun = evaluationRunSchema.parse(auto.run)

beforeEach(() => {
    postMock.mockReset()
    editSimpleEvaluation.mockReset()
})

const humanRun = {
    id: "run-h",
    data: {
        steps: [
            {
                key: "ev",
                type: "annotation" as const,
                origin: "human" as const,
                references: {evaluator_revision: {id: "evr-1"}},
            },
        ],
    },
}

describe("run edit body", () => {
    it("Editing an auto run keeps every step with its own origin", () => {
        const steps = auto.run.data.steps
        const ref = (index: number, key: string) =>
            (steps[index].references as Record<string, {id: string}>)[key].id
        // In the fixture the input and invocation steps are "custom", the evaluators "auto".
        expect(steps[0].origin).toBe("custom")

        expect(buildRunEditBody(autoRun, {name: "Capitals", description: "Second try"})).toEqual({
            evaluation: {
                id: auto.run.id,
                name: "Capitals",
                description: "Second try",
                data: {
                    testset_steps: {[ref(0, "testset_revision")]: "custom"},
                    application_steps: {[ref(1, "application_revision")]: "custom"},
                    evaluator_steps: Object.fromEntries(
                        steps
                            .slice(2)
                            .map((_, index) => [ref(index + 2, "evaluator_revision"), "auto"]),
                    ),
                },
            },
        })
    })

    it("A query run sends its query steps; a human run keeps the human origin", () => {
        const queryRun = evaluationRunSchema.parse(online.run)
        const body = buildRunEditBody(queryRun, {name: "Live", description: ""})
        expect(Object.keys(body.evaluation.data.query_steps ?? {})).toHaveLength(1)

        const human = buildRunEditBody(
            {
                id: "run-h",
                data: {
                    steps: [
                        {
                            key: "ev",
                            type: "annotation",
                            origin: "human",
                            references: {evaluator_revision: {id: "evr-1"}},
                        },
                        {
                            key: "ev2",
                            type: "annotation",
                            references: {evaluator_revision: {id: "evr-2"}},
                        },
                    ],
                },
            },
            {name: "Review", description: ""},
        )
        expect(human.evaluation.data.evaluator_steps).toEqual({"evr-1": "human", "evr-2": "human"})
        expect(human.evaluation.data).not.toHaveProperty("query_steps")
    })
})

describe("adding evaluators to a run", () => {
    it("An added evaluator joins an auto run as auto, next to the evaluators it has", () => {
        const before = buildRunEditBody(autoRun, {name: "Capitals", description: ""})
        const after = buildRunEditBody(autoRun, {
            name: "Capitals",
            description: "",
            addedEvaluatorRevisionIds: ["evr-new"],
        })
        expect(after.evaluation.data.evaluator_steps).toEqual({
            ...before.evaluation.data.evaluator_steps,
            "evr-new": "auto",
        })
        expect(after.evaluation.data.testset_steps).toEqual(before.evaluation.data.testset_steps)
        expect(after.evaluation.data.application_steps).toEqual(
            before.evaluation.data.application_steps,
        )
    })

    it("An added evaluator joins a human run as human", () => {
        const body = buildRunEditBody(humanRun, {
            name: "Review",
            description: "",
            addedEvaluatorRevisionIds: ["evr-2"],
        })
        expect(body.evaluation.data.evaluator_steps).toEqual({"evr-1": "human", "evr-2": "human"})
    })

    it("Adding an evaluator the run already has changes nothing", () => {
        const body = buildRunEditBody(humanRun, {
            name: "Review",
            description: "",
            addedEvaluatorRevisionIds: ["evr-1"],
        })
        expect(body.evaluation.data.evaluator_steps).toEqual({"evr-1": "human"})
    })
})

describe("processNewEvaluatorSteps", () => {
    it("Sends every scenario of the run, across pages, without overwriting results", async () => {
        postMock.mockImplementation(async (url: string, body: {windowing?: {next?: string}}) => {
            if (url.endsWith("/evaluations/scenarios/query")) {
                return body.windowing?.next
                    ? {data: {scenarios: [{id: "sc-3", run_id: "run-1"}], windowing: {next: null}}}
                    : {
                          data: {
                              scenarios: [
                                  {id: "sc-1", run_id: "run-1"},
                                  {id: "sc-2", run_id: "run-1"},
                              ],
                              windowing: {next: "p2"},
                          },
                      }
            }
            return {data: {}}
        })
        await expect(processNewEvaluatorSteps({projectId: "pr-1", runId: "run-1"})).resolves.toBe(3)
        const process = postMock.mock.calls.filter(([url]) => String(url).endsWith("/process"))
        expect(process).toEqual([
            [
                "https://agenta.test/api/simple/evaluations/run-1/process",
                {scenario_ids: ["sc-1", "sc-2", "sc-3"], overwrite: false},
                {params: {project_id: "pr-1"}},
            ],
        ])
    })

    it("A run without scenarios sends nothing to process", async () => {
        postMock.mockResolvedValue({data: {scenarios: [], windowing: {next: null}}})
        await expect(processNewEvaluatorSteps({projectId: "pr-1", runId: "run-1"})).resolves.toBe(0)
        expect(postMock.mock.calls.some(([url]) => String(url).endsWith("/process"))).toBe(false)
    })

    it("A failed process request throws", async () => {
        postMock.mockImplementation(async (url: string) => {
            if (url.endsWith("/process")) throw new Error("boom")
            return {data: {scenarios: [{id: "sc-1", run_id: "run-1"}], windowing: {next: null}}}
        })
        await expect(
            processNewEvaluatorSteps({projectId: "pr-1", runId: "run-1"}),
        ).rejects.toThrow()
    })
})

describe("editEvaluationRun", () => {
    it("Sends the edit through the Fern client, scoped to the project", async () => {
        editSimpleEvaluation.mockResolvedValue({evaluation: {id: auto.run.id}})
        await editEvaluationRun({
            projectId: "pr-1",
            run: autoRun,
            name: "Capitals",
            description: "",
        })
        expect(editSimpleEvaluation).toHaveBeenCalledWith(
            {
                evaluation_id: auto.run.id,
                evaluation: buildRunEditBody(autoRun, {name: "Capitals", description: ""})
                    .evaluation,
            },
            {queryParams: {project_id: "pr-1"}},
        )
    })

    it("A response without the run throws", async () => {
        editSimpleEvaluation.mockResolvedValue({evaluation: null})
        await expect(
            editEvaluationRun({projectId: "pr-1", run: autoRun, name: "x", description: ""}),
        ).rejects.toThrow("The evaluation was not updated.")
    })
})

describe("humanizeMetricLabel", () => {
    it("Prints the old app's title case metric names", () => {
        expect(humanizeMetricLabel("success")).toBe("Success")
        expect(humanizeMetricLabel("score")).toBe("Score")
        expect(humanizeMetricLabel("is_json")).toBe("Is JSON")
        expect(humanizeMetricLabel("outputs.nested.llm_verdict")).toBe("Nested LLM Verdict")
    })
})
