import {describe, expect, it} from "vitest"

import {buildRunConfig} from "../../src/core/buildRunConfig"
import type {BuildRunConfigInput, RevisionSchemaContext} from "../../src/core/types"

// NOTE ON PURITY (spike T3): this file imports ONLY buildRunConfig — no jotai store,
// no getDefaultStore, no playground atoms are set up anywhere. The fact that every
// case below runs and asserts in a plain Node vitest environment is the proof that
// buildRunConfig is pure: all schema context arrives through the input DTO.

const UUID_A = "11111111-1111-1111-1111-111111111111"
const UUID_VARIANT = "22222222-2222-2222-2222-222222222222"
const UUID_APP = "33333333-3333-3333-3333-333333333333"
const UUID_EVAL_REV = "44444444-4444-4444-4444-444444444444"

// Minimal Workflow-ish object. buildRunConfig only reads id/name/slug/workflow_*/data.
const makeRevision = (over: Record<string, unknown> = {}): any => ({
    id: UUID_A,
    name: "My App",
    slug: "my-app",
    workflow_id: UUID_APP,
    workflow_variant_id: UUID_VARIANT,
    data: {},
    ...over,
})

const emptyCtx: RevisionSchemaContext = {
    isCustom: false,
    spec: null,
    routePath: "",
    inputSchemaProperties: null,
}

const baseInput = (over: Partial<BuildRunConfigInput> = {}): BuildRunConfigInput => ({
    name: "Run 1",
    testset: {
        id: "ts-abc123456789",
        name: "My Testset",
        csvdata: [{input: "hello", correct_answer: "world"}],
    },
    revisions: [makeRevision()],
    evaluators: [],
    correctAnswerColumn: "correct_answer",
    schemaContextByRevisionId: {[UUID_A]: emptyCtx},
    ...over,
})

describe("buildRunConfig (pure)", () => {
    it("builds one run per revision with input + invocation steps", () => {
        const {runs} = buildRunConfig(baseInput())
        expect(runs).toHaveLength(1)

        const [run] = runs
        // key uses workflow_variant_id when present
        expect(run.key).toBe(`evaluation-${UUID_VARIANT}`)
        expect(run.name).toBe("Run 1")

        const types = run.data.steps.map((s) => s.type)
        expect(types).toEqual(["input", "invocation"])

        const invocation = run.data.steps.find((s) => s.type === "invocation")!
        expect(invocation.references.application).toEqual({id: UUID_APP})
        expect(invocation.references.application_variant).toEqual({id: UUID_VARIANT})
        // valid-UUID revision id resolves directly
        expect(invocation.references.application_revision).toEqual({id: UUID_A})
        expect(invocation.inputs).toEqual([{key: run.data.steps[0].key}])
    })

    it("falls back to no application_revision for a non-UUID, non-draft id", () => {
        const {runs} = buildRunConfig(
            baseInput({
                revisions: [makeRevision({id: "not-a-uuid"})],
                schemaContextByRevisionId: {"not-a-uuid": emptyCtx},
            }),
        )
        const invocation = runs[0].data.steps.find((s) => s.type === "invocation")!
        expect(invocation.references.application_revision).toBeUndefined()
    })

    it("keys the run by revision id when no workflow_variant_id", () => {
        const {runs} = buildRunConfig(
            baseInput({
                revisions: [makeRevision({workflow_variant_id: undefined})],
            }),
        )
        expect(runs[0].key).toBe(`evaluation-${UUID_A}`)
    })

    it("adds testset columns as mappings and excludes the correct-answer column", () => {
        const {runs} = buildRunConfig(baseInput())
        const mappings = runs[0].data.mappings
        const testsetNames = mappings
            .filter((m) => m.column.kind === "testset")
            .map((m) => m.column.name)

        expect(testsetNames).toContain("input")
        // correct_answer matches correctAnswerColumn → excluded
        expect(testsetNames).not.toContain("correct_answer")
        // canonical invocation output mapping always present
        expect(mappings).toContainEqual({
            column: {kind: "invocation", name: "outputs"},
            step: {key: expect.any(String), path: "attributes.ag.data.outputs"},
        })
    })

    it("reads testset columns from data.testcases[].data", () => {
        const {runs} = buildRunConfig(
            baseInput({
                testset: {
                    id: "ts-xyz000000000",
                    name: "TC Testset",
                    data: {testcases: [{data: {question: "q1", topic: "t1"}}]},
                },
            }),
        )
        const names = runs[0].data.mappings
            .filter((m) => m.column.kind === "testset")
            .map((m) => m.column.name)
        expect(names).toEqual(expect.arrayContaining(["question", "topic"]))
    })

    it("reads testset columns from data.columns list", () => {
        const {runs} = buildRunConfig(
            baseInput({
                testset: {
                    id: "ts-col000000000",
                    name: "Col Testset",
                    data: {columns: ["alpha", "beta", "__hidden"]},
                },
            }),
        )
        const names = runs[0].data.mappings
            .filter((m) => m.column.kind === "testset")
            .map((m) => m.column.name)
        expect(names).toEqual(expect.arrayContaining(["alpha", "beta"]))
        // __-prefixed columns are filtered out
        expect(names).not.toContain("__hidden")
    })

    it("non-custom: adds schema-derived input vars only when present in testset columns", () => {
        const ctx: RevisionSchemaContext = {
            ...emptyCtx,
            inputSchemaProperties: {question: {}, missing_col: {}},
        }
        const {runs} = buildRunConfig(
            baseInput({
                testset: {
                    id: "ts-q00000000000",
                    name: "Q Testset",
                    csvdata: [{question: "hi"}],
                },
                schemaContextByRevisionId: {[UUID_A]: ctx},
            }),
        )
        const mapped = runs[0].data.mappings.filter((m) => m.column.kind === "testset")
        expect(mapped).toContainEqual({
            column: {kind: "testset", name: "question"},
            step: {key: expect.any(String), path: "data.question"},
        })
        // missing_col is in the schema but NOT in the testset → not mapped
        expect(mapped.map((m) => m.column.name)).not.toContain("missing_col")
    })

    it("builds annotation steps and evaluator metric mappings from evaluator output schema", () => {
        const evaluator: any = {
            id: UUID_EVAL_REV,
            name: "Exact Match",
            slug: "exact-match",
            workflow_id: UUID_APP,
            workflow_variant_id: UUID_VARIANT,
            data: {
                schemas: {
                    outputs: {
                        type: "object",
                        properties: {
                            score: {type: "number"},
                            passed: {type: "boolean"},
                        },
                    },
                },
            },
        }
        const {runs} = buildRunConfig(baseInput({evaluators: [evaluator]}))
        const steps = runs[0].data.steps
        const annotation = steps.find((s) => s.type === "annotation")!
        expect(annotation).toBeTruthy()
        expect(annotation.key.endsWith(".exact-match")).toBe(true)
        expect(annotation.references.evaluator_revision).toEqual({id: UUID_EVAL_REV})

        const evalMappings = runs[0].data.mappings.filter((m) => m.column.kind === "evaluator")
        const names = evalMappings.map((m) => m.column.name)
        expect(names).toEqual(expect.arrayContaining(["exact-match.score", "exact-match.passed"]))
        const scoreMapping = evalMappings.find((m) => m.column.name === "exact-match.score")!
        expect(scoreMapping.step.path).toBe("data.outputs.score")
    })

    it("passes meta through to each run", () => {
        const meta = {source: "unit-test"}
        const {runs} = buildRunConfig(baseInput({meta}))
        expect(runs[0].meta).toEqual(meta)
    })

    it("is deterministic — same input yields deep-equal output (no hidden state)", () => {
        const input = baseInput({evaluators: []})
        const a = buildRunConfig(input)
        const b = buildRunConfig(input)
        expect(a).toEqual(b)
    })

    it("produces one run per revision for multiple revisions", () => {
        const r1 = makeRevision({id: UUID_A, workflow_variant_id: UUID_VARIANT})
        const r2 = makeRevision({
            id: "55555555-5555-5555-5555-555555555555",
            workflow_variant_id: undefined,
            name: "Second",
            slug: "second",
        })
        const {runs} = buildRunConfig(
            baseInput({
                revisions: [r1, r2],
                schemaContextByRevisionId: {
                    [UUID_A]: emptyCtx,
                    "55555555-5555-5555-5555-555555555555": emptyCtx,
                },
            }),
        )
        expect(runs.map((r) => r.key)).toEqual([
            `evaluation-${UUID_VARIANT}`,
            "evaluation-55555555-5555-5555-5555-555555555555",
        ])
    })
})
