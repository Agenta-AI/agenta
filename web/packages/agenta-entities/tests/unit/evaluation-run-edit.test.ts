import {beforeEach, describe, expect, it, vi} from "vitest"

const {editSimpleEvaluation} = vi.hoisted(() => ({editSimpleEvaluation: vi.fn()}))

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
} from "../../src/evaluationRun"
import auto from "../fixtures/evaluationRun/auto-metrics.json"
import online from "../fixtures/evaluationRun/online-metrics.json"

const autoRun = evaluationRunSchema.parse(auto.run)

beforeEach(() => editSimpleEvaluation.mockReset())

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
