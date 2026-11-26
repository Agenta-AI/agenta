import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

const {postMock} = vi.hoisted(() => ({postMock: vi.fn()}))

vi.mock("@agenta/shared/api", () => ({
    axios: {post: postMock},
    getAgentaApiUrl: () => "https://agenta.test/api",
}))

import {annotationSchema} from "../../src/annotation/core/schema"
import {evaluationQueueSchema} from "../../src/evaluationQueue/core/schema"
import {queryEvaluationRunsPage, runTagLabels} from "../../src/evaluationRun"
import {evaluationMetricSchema, evaluationRunSchema} from "../../src/evaluationRun/core/schema"
import {simpleQueueSchema} from "../../src/simpleQueue/core/schema"

// The API types tags as `Dict[str, LabelJson]` and a reference id as `Optional[UUID]`.
const run = (overrides: Record<string, unknown> = {}) => ({
    id: "run-1",
    name: "Nightly",
    status: "success",
    data: {
        steps: [
            {
                key: "testset",
                type: "input",
                origin: "custom",
                references: {testset: {id: "ts-1"}},
            },
            {
                key: "evaluator",
                type: "annotation",
                origin: "auto",
                references: {evaluator: {id: "ev-1", slug: "exact-match"}},
            },
        ],
    },
    ...overrides,
})

describe("evaluationRunSchema tags and references", () => {
    it("accepts a run with dictionary tags", () => {
        const result = evaluationRunSchema.safeParse(
            run({tags: {suite: "bench", round: 3, flags: {smoke: true}}}),
        )

        expect(result.success).toBe(true)
        expect(result.success && result.data.tags).toEqual({
            suite: "bench",
            round: 3,
            flags: {smoke: true},
        })
    })

    it("accepts a run whose reference has only a slug", () => {
        const result = evaluationRunSchema.safeParse(
            run({
                data: {
                    steps: [
                        {
                            key: "evaluator",
                            type: "annotation",
                            origin: "auto",
                            references: {
                                evaluator: {slug: "exact-match"},
                                evaluator_revision: {id: null, slug: "exact-match", version: 2},
                            },
                        },
                    ],
                },
            }),
        )

        expect(result.success).toBe(true)
        const references = result.success ? result.data.data?.steps?.[0].references : null
        expect(references?.evaluator).toEqual({slug: "exact-match"})
        expect(references?.evaluator_revision?.id).toBeNull()
    })

    it("accepts a run with no tags and with null tags", () => {
        expect(evaluationRunSchema.safeParse(run()).success).toBe(true)
        expect(evaluationRunSchema.safeParse(run({tags: null})).success).toBe(true)
    })

    it("accepts dictionary tags on a metric", () => {
        const result = evaluationMetricSchema.safeParse({
            id: "m-1",
            run_id: "run-1",
            tags: {suite: "bench"},
        })
        expect(result.success).toBe(true)
    })
})

describe("queue schemas tags", () => {
    it("accept dictionary tags on an evaluation queue and a simple queue", () => {
        const queue = {id: "q-1", run_id: "run-1", tags: {owner: "qa"}}
        expect(evaluationQueueSchema.safeParse(queue).success).toBe(true)
        expect(simpleQueueSchema.safeParse(queue).success).toBe(true)
    })
})

describe("annotationSchema references and meta", () => {
    const annotation = (overrides: Record<string, unknown> = {}) => ({
        trace_id: "t-1",
        span_id: "s-1",
        data: {outputs: {score: 1}},
        references: {evaluator: {slug: "exact-match"}},
        ...overrides,
    })

    it("accepts a slug-only reference and reads a null id as absent", () => {
        const result = annotationSchema.safeParse(
            annotation({references: {evaluator: {id: null, slug: "exact-match"}}}),
        )
        expect(result.success).toBe(true)
        expect(result.success && result.data.references?.evaluator.id).toBeUndefined()
    })

    it("keeps the annotation when meta.tags is not a list", () => {
        const result = annotationSchema.safeParse(
            annotation({meta: {name: "Score", tags: {suite: "bench"}}}),
        )
        expect(result.success).toBe(true)
        expect(result.success && result.data.meta).toEqual({name: "Score", tags: undefined})
    })
})

describe("runTagLabels", () => {
    it("shows each dictionary entry as key: value", () => {
        expect(runTagLabels({suite: "bench", round: 3, flags: {smoke: true}})).toEqual([
            "suite: bench",
            "round: 3",
            'flags: {"smoke":true}',
        ])
    })

    it("returns no labels for missing tags", () => {
        expect(runTagLabels(null)).toEqual([])
        expect(runTagLabels(undefined)).toEqual([])
    })
})

describe("queryEvaluationRunsPage with a run that fails validation", () => {
    let errorSpy: ReturnType<typeof vi.spyOn>

    beforeEach(() => {
        postMock.mockReset()
        errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    })

    afterEach(() => {
        errorSpy.mockRestore()
    })

    it("skips and logs the bad run and keeps the others", async () => {
        postMock.mockResolvedValue({
            data: {
                count: 3,
                runs: [
                    run({id: "good-1", tags: {suite: "bench"}}),
                    {name: "no id"},
                    run({id: "good-2"}),
                ],
                windowing: {next: "c1"},
            },
        })

        const page = await queryEvaluationRunsPage({projectId: "p1", limit: 3})

        expect(page.runs.map((r) => r.id)).toEqual(["good-1", "good-2"])
        expect(page.nextCursor).toBe("c1")
        expect(errorSpy).toHaveBeenCalledTimes(1)
    })
})
