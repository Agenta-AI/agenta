/**
 * Unit tests for pure helper functions exported from annotationFormController.ts:
 *   - isEmptyValue
 *   - getOutputsSchema
 *   - getMetricFieldsFromEvaluator
 *   - getMetricsFromAnnotation
 *
 * The module has many heavy imports (Jotai atoms, entity API calls, session
 * controller). We mock the external packages so no network or Jotai store
 * is touched during tests.
 */

import {beforeEach, describe, expect, it, vi} from "vitest"

// ---------------------------------------------------------------------------
// Module-level mocks — vi.mock is hoisted before imports by Vitest
// ---------------------------------------------------------------------------

const mockResolveOutputSchema = vi.fn()

vi.mock("@agenta/entities/workflow", () => ({
    resolveOutputSchema: (data: unknown) => mockResolveOutputSchema(data),
    workflowQueryAtomFamily: () => ({isPending: false, data: null}),
    workflowLatestRevisionQueryAtomFamily: () => ({isPending: false, data: null}),
}))

vi.mock("@agenta/entities/annotation", () => ({
    createAnnotation: vi.fn(),
    updateAnnotation: vi.fn(),
    invalidateAnnotationCacheByLink: vi.fn(),
}))

vi.mock("@agenta/entities/evaluationRun", () => ({
    evaluationRunMolecule: {selectors: {annotationSteps: vi.fn(), scenarioSteps: vi.fn()}},
    queryEvaluationResults: vi.fn(),
}))

vi.mock("@agenta/entities/simpleQueue", () => ({
    invalidateScenarioProgressCache: vi.fn(),
    invalidateSimpleQueueCache: vi.fn(),
    invalidateSimpleQueuesListCache: vi.fn(),
    simpleQueuePaginatedStore: {refreshAtom: {}},
}))

vi.mock("@agenta/entities/trace", () => ({
    fetchPreviewTrace: vi.fn(),
}))

vi.mock("@agenta/shared/api", () => ({
    axios: {patch: vi.fn(), post: vi.fn()},
    getAgentaApiUrl: () => "http://localhost",
    queryClient: {invalidateQueries: vi.fn()},
}))

vi.mock("@agenta/shared/state", () => ({
    projectIdAtom: {},
}))

vi.mock("../../src/state/controllers/annotationSessionController", () => ({
    annotationSessionController: {
        selectors: {
            evaluatorStepRefs: () => ({}),
            scenarioAnnotations: () => ({}),
            scenarioStatuses: () => ({}),
            activeRunId: () => ({}),
            focusAutoNext: () => ({}),
        },
        set: {markCompleted: vi.fn(), navigateNext: vi.fn()},
        cache: {invalidateScenarioAnnotations: vi.fn()},
    },
}))

// Import the functions AFTER all vi.mock() declarations.
// The schema-extraction helpers live in `@agenta/evaluations/state` (metricSchema tier).
import {
    getMetricFieldsFromEvaluator,
    getMetricsFromAnnotation,
    getOutputsSchema,
} from "@agenta/evaluations/state"
import {isEmptyValue} from "../../src/state/controllers/annotationFormController"
import type {Annotation} from "@agenta/entities/annotation"
import type {Workflow} from "@agenta/entities/workflow"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeWorkflow(schemaProperties: Record<string, unknown> = {}): Workflow {
    // resolveOutputSchema is mocked to return its input,
    // so we set data to the schema shape directly.
    return {
        data: {properties: schemaProperties},
        slug: "test-evaluator",
        id: "wf-1",
    } as unknown as Workflow
}

function makeAnnotation(
    outputs: Record<string, unknown>,
    references?: {evaluator?: {slug?: string}},
): Annotation {
    return {
        trace_id: "trace-1",
        span_id: "span-1",
        data: {outputs},
        references,
        meta: {},
    } as unknown as Annotation
}

beforeEach(() => {
    // Default: resolveOutputSchema returns the data as-is (pass-through)
    mockResolveOutputSchema.mockImplementation((data: unknown) => data)
})

// ---------------------------------------------------------------------------
// isEmptyValue
// ---------------------------------------------------------------------------

describe("isEmptyValue", () => {
    it.each([
        [null, true],
        [undefined, true],
        ["", true],
        [[], true],
    ])("returns true for %s", (value, expected) => {
        expect(isEmptyValue(value)).toBe(expected)
    })

    it.each([
        [0, false],
        [false, false],
        ["0", false],
        [[null], false],
        [{}, false],
        [" ", false],
    ])("returns false for %s", (value, expected) => {
        expect(isEmptyValue(value)).toBe(expected)
    })
})

// ---------------------------------------------------------------------------
// getOutputsSchema
// ---------------------------------------------------------------------------

describe("getOutputsSchema", () => {
    it("returns the schema from resolveOutputSchema", () => {
        const schema = {properties: {score: {type: "number"}}}
        const workflow = makeWorkflow(schema.properties)
        const result = getOutputsSchema(workflow)
        expect(result).toMatchObject({properties: {score: {type: "number"}}})
    })

    it("returns empty object when resolveOutputSchema returns null", () => {
        mockResolveOutputSchema.mockReturnValueOnce(null)
        const result = getOutputsSchema(makeWorkflow())
        expect(result).toEqual({})
    })
})

// ---------------------------------------------------------------------------
// getMetricFieldsFromEvaluator — scalar types
// ---------------------------------------------------------------------------

describe("getMetricFieldsFromEvaluator — scalar types", () => {
    it("produces a number field with null default", () => {
        const wf = makeWorkflow({score: {type: "number", minimum: 0, maximum: 10}})
        const fields = getMetricFieldsFromEvaluator(wf)
        expect(fields.score).toMatchObject({value: null, type: "number", minimum: 0, maximum: 10})
    })

    it("produces an integer field with null default", () => {
        const wf = makeWorkflow({count: {type: "integer"}})
        expect(getMetricFieldsFromEvaluator(wf).count).toMatchObject({value: null, type: "integer"})
    })

    it("produces a boolean field with null default", () => {
        const wf = makeWorkflow({approved: {type: "boolean"}})
        expect(getMetricFieldsFromEvaluator(wf).approved).toMatchObject({
            value: null,
            type: "boolean",
        })
    })

    it("produces a string field with empty-string default", () => {
        const wf = makeWorkflow({notes: {type: "string"}})
        expect(getMetricFieldsFromEvaluator(wf).notes).toMatchObject({value: "", type: "string"})
    })
})

describe("getMetricFieldsFromEvaluator — array type", () => {
    it("produces an array field with item schema", () => {
        const wf = makeWorkflow({
            labels: {
                type: "array",
                items: {type: "string", enum: ["good", "bad"]},
            },
        })
        const fields = getMetricFieldsFromEvaluator(wf)
        expect(fields.labels).toMatchObject({
            value: [],
            type: "array",
            items: {type: "string", enum: ["good", "bad"]},
        })
    })

    it("defaults item type to string when items is missing", () => {
        const wf = makeWorkflow({tags: {type: "array"}})
        expect(getMetricFieldsFromEvaluator(wf).tags.items).toMatchObject({
            type: "string",
            enum: [],
        })
    })
})

describe("getMetricFieldsFromEvaluator — anyOf schema", () => {
    it("unwraps the first anyOf entry to get the real type", () => {
        const wf = makeWorkflow({
            score: {anyOf: [{type: "number", minimum: 0}, {type: "null"}]},
        })
        expect(getMetricFieldsFromEvaluator(wf).score).toMatchObject({value: null, type: "number"})
    })
})

describe("getMetricFieldsFromEvaluator — array-of-types", () => {
    it("filters 'null' from the type array and uses the remaining types", () => {
        const wf = makeWorkflow({status: {type: ["string", "null"]}})
        const field = getMetricFieldsFromEvaluator(wf).status
        expect(field.type).toEqual(["string"])
        expect(field.value).toBe("")
    })

    it("skips the property when only 'null' type remains after filtering", () => {
        const wf = makeWorkflow({x: {type: ["null"]}})
        expect(getMetricFieldsFromEvaluator(wf)).not.toHaveProperty("x")
    })

    it("includes non-null enum values and strips null/empty entries", () => {
        const wf = makeWorkflow({
            choice: {type: ["string", "null"], enum: ["a", null, "", "b"]},
        })
        const field = getMetricFieldsFromEvaluator(wf).choice
        expect(field.enum).toEqual(["a", "b"])
    })
})

describe("getMetricFieldsFromEvaluator — edge cases", () => {
    it("returns empty object for an empty schema", () => {
        mockResolveOutputSchema.mockReturnValueOnce(null)
        expect(getMetricFieldsFromEvaluator(makeWorkflow())).toEqual({})
    })

    it("skips unsupported types (e.g. 'object')", () => {
        const wf = makeWorkflow({meta: {type: "object"}})
        expect(getMetricFieldsFromEvaluator(wf)).not.toHaveProperty("meta")
    })

    it("skips properties with no type field", () => {
        const wf = makeWorkflow({weird: {description: "no type here"}})
        expect(getMetricFieldsFromEvaluator(wf)).not.toHaveProperty("weird")
    })
})

// ---------------------------------------------------------------------------
// getMetricsFromAnnotation — flat outputs
// ---------------------------------------------------------------------------

describe("getMetricsFromAnnotation — flat outputs matching schema", () => {
    it("fills a number field from flat outputs", () => {
        const wf = makeWorkflow({score: {type: "number"}})
        const ann = makeAnnotation({score: 8.5})
        const fields = getMetricsFromAnnotation(ann, wf)
        expect(fields.score).toMatchObject({value: 8.5, type: "number"})
    })

    it("fills a string field from flat outputs", () => {
        // "notes" is a reserved flattening key — use a plain field name
        const wf = makeWorkflow({label: {type: "string"}})
        const ann = makeAnnotation({label: "looks good"})
        expect(getMetricsFromAnnotation(ann, wf).label).toMatchObject({
            value: "looks good",
            type: "string",
        })
    })

    it("uses schema default when key is absent in outputs", () => {
        const wf = makeWorkflow({score: {type: "number"}})
        const ann = makeAnnotation({})
        expect(getMetricsFromAnnotation(ann, wf).score).toMatchObject({value: null, type: "number"})
    })

    it("uses '' as default for a missing string field", () => {
        const wf = makeWorkflow({label: {type: "string"}})
        const ann = makeAnnotation({})
        expect(getMetricsFromAnnotation(ann, wf).label.value).toBe("")
    })
})

// ---------------------------------------------------------------------------
// getMetricsFromAnnotation — nested output structures
// ---------------------------------------------------------------------------

describe("getMetricsFromAnnotation — nested outputs", () => {
    it("flattens metrics nested under 'metrics' key", () => {
        const wf = makeWorkflow({score: {type: "number"}})
        const ann = makeAnnotation({metrics: {score: 9}})
        expect(getMetricsFromAnnotation(ann, wf).score.value).toBe(9)
    })

    it("flattens fields nested under 'notes' key", () => {
        const wf = makeWorkflow({comment: {type: "string"}})
        const ann = makeAnnotation({notes: {comment: "great"}})
        expect(getMetricsFromAnnotation(ann, wf).comment.value).toBe("great")
    })

    it("flattens fields nested under 'extra' key", () => {
        const wf = makeWorkflow({custom: {type: "string"}})
        const ann = makeAnnotation({extra: {custom: "value"}})
        expect(getMetricsFromAnnotation(ann, wf).custom.value).toBe("value")
    })

    it("flat keys outside of metrics/notes/extra are preserved directly", () => {
        const wf = makeWorkflow({direct: {type: "number"}})
        const ann = makeAnnotation({direct: 42})
        expect(getMetricsFromAnnotation(ann, wf).direct.value).toBe(42)
    })
})

// ---------------------------------------------------------------------------
// getMetricsFromAnnotation — schema-free (infer from outputs)
// ---------------------------------------------------------------------------

describe("getMetricsFromAnnotation — schema-free inference", () => {
    beforeEach(() => {
        // Empty schema → falls back to inferFieldsFromOutputs
        mockResolveOutputSchema.mockReturnValue(null)
    })

    it("infers a number field from a numeric output value", () => {
        const wf = makeWorkflow()
        const ann = makeAnnotation({score: 7})
        const fields = getMetricsFromAnnotation(ann, wf)
        expect(fields.score.type).toBe("integer")
        expect(fields.score.value).toBe(7)
    })

    it("infers a boolean field from a boolean output value", () => {
        const wf = makeWorkflow()
        const ann = makeAnnotation({approved: true})
        expect(getMetricsFromAnnotation(ann, wf).approved).toMatchObject({
            value: true,
            type: "boolean",
        })
    })

    it("infers a string field from a string output value", () => {
        // "notes" is a reserved key — use a plain field name
        const wf = makeWorkflow()
        const ann = makeAnnotation({comment: "hello"})
        expect(getMetricsFromAnnotation(ann, wf).comment).toMatchObject({
            value: "hello",
            type: "string",
        })
    })

    it("serialises an object output to a JSON string field", () => {
        const wf = makeWorkflow()
        const ann = makeAnnotation({meta: {key: "val"}})
        const field = getMetricsFromAnnotation(ann, wf).meta
        expect(field.type).toBe("string")
        expect(field.value).toBe(JSON.stringify({key: "val"}))
    })

    it("returns empty object when annotation outputs are empty", () => {
        const wf = makeWorkflow()
        const ann = makeAnnotation({})
        expect(getMetricsFromAnnotation(ann, wf)).toEqual({})
    })
})
