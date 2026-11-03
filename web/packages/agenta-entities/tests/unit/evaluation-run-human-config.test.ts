import {projectIdAtom} from "@agenta/shared/state"
import {getDefaultStore} from "jotai/vanilla"
import {beforeEach, describe, expect, it, vi} from "vitest"

const {postMock, deleteMock} = vi.hoisted(() => ({postMock: vi.fn(), deleteMock: vi.fn()}))

vi.mock("@agenta/shared/api", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@agenta/shared/api")>()),
    axios: {post: postMock, delete: deleteMock},
    getAgentaApiUrl: () => "https://agenta.test/api",
}))

import {
    buildHumanRunConfig,
    createHumanEvaluationRun,
    evaluationRunMolecule,
    evaluatorOutputKeys,
    fetchAllTestcaseIds,
    type BuildHumanRunConfigInput,
    type HumanRunEvaluator,
} from "../../src/evaluationRun"

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`

const evaluator = (n: number, overrides: Partial<HumanRunEvaluator> = {}): HumanRunEvaluator => ({
    revisionId: uuid(100 + n),
    workflowId: uuid(200 + n),
    variantId: uuid(300 + n),
    slug: `quality-${n}`,
    outputKeys: ["score"],
    ...overrides,
})

const input = (overrides: Partial<BuildHumanRunConfigInput> = {}): BuildHumanRunConfigInput => ({
    name: "Human check",
    testset: {
        id: uuid(1),
        name: "Support Questions",
        revisionId: uuid(2),
        columns: ["question", "country", "correct_answer", "testcase_dedup_id", "__meta"],
    },
    revision: {id: uuid(3), name: "Support Bot", workflowId: uuid(4), variantId: uuid(5)},
    inputKeys: ["question", "missing_column"],
    hasMessagesInput: false,
    evaluators: [evaluator(1), evaluator(2)],
    ...overrides,
})

const specOf = (config: BuildHumanRunConfigInput = input()) => buildHumanRunConfig(config).runs[0]

describe("buildHumanRunConfig", () => {
    it("Each evaluator gets its own annotation step key from its slug", () => {
        const steps = specOf().data.steps
        const annotationKeys = steps.filter((step) => step.type === "annotation").map((s) => s.key)

        expect(annotationKeys).toEqual([
            "support-bot-000000000003.quality-1",
            "support-bot-000000000003.quality-2",
        ])
        expect(new Set(annotationKeys).size).toBe(2)
        expect(annotationKeys.join()).not.toContain("undefined")
    })

    it("Two evaluators with the same slug throw", () => {
        expect(() =>
            buildHumanRunConfig(
                input({evaluators: [evaluator(1), evaluator(2, {slug: "quality-1"})]}),
            ),
        ).toThrow(/share the slug/)
        expect(() => buildHumanRunConfig(input({evaluators: [evaluator(1, {slug: ""})]}))).toThrow()
    })

    it("Evaluator steps reference the evaluator, its variant and its revision", () => {
        const [annotation] = specOf().data.steps.filter((step) => step.type === "annotation")

        expect(annotation.references).toEqual({
            evaluator: {id: uuid(201)},
            evaluator_variant: {id: uuid(301)},
            evaluator_revision: {id: uuid(101)},
        })
        expect(annotation).toMatchObject({origin: "human", type: "annotation"})
        expect(annotation.inputs?.map((i) => i.key)).toEqual([
            "support-questions-000000000001",
            "support-bot-000000000003",
        ])
    })

    it("Steps, references and run header follow the human run recipe", () => {
        const spec = specOf()
        const [inputStep, invocationStep] = spec.data.steps

        expect(inputStep).toEqual({
            key: "support-questions-000000000001",
            type: "input",
            origin: "auto",
            references: {testset: {id: uuid(1)}, testset_revision: {id: uuid(2)}},
        })
        expect(invocationStep).toMatchObject({
            type: "invocation",
            origin: "human",
            references: {
                application: {id: uuid(4)},
                application_variant: {id: uuid(5)},
                application_revision: {id: uuid(3)},
            },
        })
        expect(spec).toMatchObject({
            key: `evaluation-${uuid(5)}`,
            name: "Human check",
            meta: {evaluation_kind: "human"},
        })
    })

    it("References that are not UUIDs are left out", () => {
        const spec = specOf(input({revision: {id: "draft-1", name: "Draft", workflowId: "x"}}))

        expect(spec.data.steps[1].references).toEqual({})
        expect(spec.key).toBe("evaluation-draft-1")
    })

    it("Input mappings keep only input keys that are test set columns", () => {
        const names = specOf().data.mappings.map((m) => m.column.name)

        expect(names).toContain("question")
        expect(names).not.toContain("missing_column")
    })

    it("Correct answer, testcase and dedup columns get no mapping", () => {
        const testsetNames = specOf()
            .data.mappings.filter((m) => m.column.kind === "testset")
            .map((m) => m.column.name)

        expect(testsetNames).toEqual(["question", "country"])
    })

    it("The messages column is mapped when the app takes messages", () => {
        const mappings = specOf(
            input({
                hasMessagesInput: true,
                inputKeys: [],
                testset: {id: uuid(1), name: "Chats", columns: ["messages"]},
            }),
        ).data.mappings

        expect(mappings[0]).toEqual({
            column: {kind: "testset", name: "messages"},
            step: {key: "chats-000000000001", path: "data.inputs.messages"},
        })
        expect(mappings.filter((m) => m.column.name === "messages")).toHaveLength(1)
    })

    it("Each evaluator output key gets a mapping under the evaluator slug", () => {
        const mappings = specOf(
            input({evaluators: [evaluator(1, {outputKeys: ["score", "notes"]})]}),
        ).data.mappings

        expect(mappings.filter((m) => m.column.kind === "evaluator")).toEqual([
            {
                column: {kind: "evaluator", name: "quality-1.score"},
                step: {key: "support-bot-000000000003.quality-1", path: "data.outputs.score"},
            },
            {
                column: {kind: "evaluator", name: "quality-1.notes"},
                step: {key: "support-bot-000000000003.quality-1", path: "data.outputs.notes"},
            },
        ])
        expect(mappings.find((m) => m.column.kind === "invocation")).toEqual({
            column: {kind: "invocation", name: "outputs"},
            step: {key: "support-bot-000000000003", path: "attributes.ag.data.outputs"},
        })
    })
})

describe("evaluatorOutputKeys", () => {
    it("Nested evaluator outputs become dotted keys", () => {
        const data = {
            schemas: {
                outputs: {
                    type: "object",
                    properties: {
                        score: {type: "number"},
                        grade: {type: "integer"},
                        passed: {anyOf: [{type: "boolean"}, {type: "null"}]},
                        details: {type: "object", properties: {reason: {type: "string"}}},
                        tags: {type: "array", items: {type: "string"}},
                        blob: {type: "object"},
                    },
                },
            },
        }

        expect(evaluatorOutputKeys(data)).toEqual([
            "score",
            "grade",
            "passed",
            "details.reason",
            "tags",
        ])
    })

    it("An evaluator without an output schema has no keys", () => {
        expect(evaluatorOutputKeys(null)).toEqual([])
        expect(evaluatorOutputKeys({})).toEqual([])
    })
})

describe("createHumanEvaluationRun", () => {
    beforeEach(() => {
        postMock.mockReset()
        deleteMock.mockReset()
    })

    const spec = () => specOf()
    const answers = (scenarioCount: number) => {
        postMock.mockImplementation(async (url: string) => {
            if (url.endsWith("/evaluations/runs/")) return {data: {runs: [{id: "run-1"}]}}
            if (url.endsWith("/evaluations/scenarios/")) {
                return {
                    data: {
                        scenarios: Array.from({length: scenarioCount}, (_, i) => ({id: `sc-${i}`})),
                    },
                }
            }
            return {data: {}}
        })
    }

    it("Human create posts the run, then one scenario per testcase, then input, invocation and annotation results", async () => {
        answers(2)
        const runSpec = spec()

        const result = await createHumanEvaluationRun({
            projectId: "p1",
            spec: runSpec,
            testcaseIds: ["tc-1", "tc-2"],
        })

        expect(result).toEqual({runId: "run-1"})
        expect(postMock.mock.calls.map((call) => call[0])).toEqual([
            "https://agenta.test/api/evaluations/runs/",
            "https://agenta.test/api/evaluations/scenarios/",
            "https://agenta.test/api/evaluations/results/",
        ])
        expect(postMock.mock.calls[0][1]).toEqual({runs: [runSpec]})
        expect(postMock.mock.calls[1][1]).toEqual({
            scenarios: [{run_id: "run-1"}, {run_id: "run-1"}],
        })
        const [input, invocation, ann1, ann2] = runSpec.data.steps.map((s) => s.key)
        const base = (i: number) => ({
            testcase_id: `tc-${i + 1}`,
            scenario_id: `sc-${i}`,
            run_id: "run-1",
        })
        expect(postMock.mock.calls[2][1].results).toEqual(
            [0, 1].flatMap((i) => [
                {...base(i), status: "success", step_key: input},
                {...base(i), step_key: invocation},
                {...base(i), step_key: ann1},
                {...base(i), step_key: ann2},
            ]),
        )
        expect(deleteMock).not.toHaveBeenCalled()
    })

    it("A failed results request deletes the new run and throws", async () => {
        answers(1)
        postMock.mockImplementationOnce(async () => ({data: {runs: [{id: "run-1"}]}}))
        postMock.mockImplementationOnce(async () => ({data: {scenarios: [{id: "sc-0"}]}}))
        postMock.mockRejectedValueOnce(new Error("results failed"))
        deleteMock.mockResolvedValue({})

        await expect(
            createHumanEvaluationRun({projectId: "p1", spec: spec(), testcaseIds: ["tc-1"]}),
        ).rejects.toThrow("results failed")

        expect(deleteMock).toHaveBeenCalledWith("https://agenta.test/api/evaluations/runs/", {
            params: {project_id: "p1"},
            data: {run_ids: ["run-1"]},
        })
    })

    it("A scenario count that does not match deletes the new run and throws", async () => {
        answers(1)
        deleteMock.mockResolvedValue({})

        await expect(
            createHumanEvaluationRun({projectId: "p1", spec: spec(), testcaseIds: ["a", "b"]}),
        ).rejects.toThrow(/scenarios/)
        expect(deleteMock).toHaveBeenCalledTimes(1)
    })

    it("A test set with no test cases creates nothing", async () => {
        await expect(
            createHumanEvaluationRun({projectId: "p1", spec: spec(), testcaseIds: []}),
        ).rejects.toThrow()
        expect(postMock).not.toHaveBeenCalled()
    })

    it("All testcase ids reads every page of the revision", async () => {
        const testcase = (id: string) => ({id, data: {}})
        postMock
            .mockResolvedValueOnce({
                data: {
                    count: 2,
                    testcases: [testcase("a"), testcase("b")],
                    windowing: {next: "n1"},
                },
            })
            .mockResolvedValueOnce({data: {count: 1, testcases: [testcase("c")], windowing: {}}})

        const ids = await fetchAllTestcaseIds({projectId: "p1", testsetRevisionId: "rev-1"})

        expect(ids).toEqual(["a", "b", "c"])
        expect(postMock.mock.calls[0][1]).toEqual({
            testset_revision_ref: {id: "rev-1"},
            windowing: {limit: 500},
        })
        expect(postMock.mock.calls[1][1].windowing).toEqual({limit: 500, next: "n1"})
    })
})

describe("run details read the built run", () => {
    it("The run details molecule lists one annotation step per evaluator", async () => {
        postMock.mockReset()
        const spec = specOf()
        postMock.mockResolvedValue({
            data: {count: 1, runs: [{id: "run-details-1", status: "running", ...spec}]},
        })
        const store = getDefaultStore()
        store.set(projectIdAtom, "p1")

        const atom = evaluationRunMolecule.selectors.annotationSteps("run-details-1")
        const unsubscribe = store.sub(atom, () => undefined)
        try {
            await vi.waitFor(() => expect(store.get(atom)).toHaveLength(2))
        } finally {
            unsubscribe()
        }

        expect(store.get(atom).map((step) => step.references?.evaluator?.id)).toEqual([
            uuid(201),
            uuid(202),
        ])
        expect(store.get(evaluationRunMolecule.selectors.evaluatorIds("run-details-1"))).toEqual([
            uuid(201),
            uuid(202),
        ])
    })
})
