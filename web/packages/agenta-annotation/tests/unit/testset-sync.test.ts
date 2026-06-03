/**
 * Unit tests for pure functions in src/state/testsetSync.ts.
 *
 * All functions under test are pure data transformations with no side effects.
 * The entity imports in testsetSync.ts are type-only, so no mocking is needed.
 */

import {describe, expect, it} from "vitest"

import type {Annotation} from "../../src/state/testsetSync"
import {
    buildTestcaseExportRows,
    buildTestsetSyncOperations,
    buildTestsetSyncPreview,
    buildTraceTestsetRows,
    getQueueAnnotationTag,
    getTestsetSyncEvaluatorColumnKey,
    mergeTestcaseAnnotationTags,
    remapTargetRowsToBaseRevision,
    selectQueueScopedAnnotation,
    TESTCASE_QUEUE_KIND_TAG,
} from "../../src/state/testsetSync"

// ---------------------------------------------------------------------------
// Minimal fixture builders
// ---------------------------------------------------------------------------

function makeAnnotation(
    overrides: {
        evaluatorSlug?: string
        evaluatorId?: string
        tags?: string[]
        outputs?: Record<string, unknown>
        traceId?: string
        spanId?: string
    } = {},
): Annotation {
    return {
        trace_id: overrides.traceId ?? "trace-1",
        span_id: overrides.spanId ?? "span-1",
        meta: {tags: overrides.tags ?? []},
        references: {
            evaluator: {
                id: overrides.evaluatorId,
                slug: overrides.evaluatorSlug,
            },
        },
        data: {outputs: overrides.outputs ?? {}},
    } as unknown as Annotation
}

function queueTag(queueId: string) {
    return `agenta:queue:${queueId}`
}

// ---------------------------------------------------------------------------
// getQueueAnnotationTag
// ---------------------------------------------------------------------------

describe("getQueueAnnotationTag", () => {
    it("formats queue ID into tag", () => {
        expect(getQueueAnnotationTag("q-abc")).toBe("agenta:queue:q-abc")
    })

    it("handles arbitrary queue IDs", () => {
        expect(getQueueAnnotationTag("123-456-789")).toBe("agenta:queue:123-456-789")
    })
})

// ---------------------------------------------------------------------------
// mergeTestcaseAnnotationTags
// ---------------------------------------------------------------------------

describe("mergeTestcaseAnnotationTags", () => {
    it("always includes the queue tag and kind tag", () => {
        const tags = mergeTestcaseAnnotationTags({queueId: "q-1"})
        expect(tags).toContain(queueTag("q-1"))
        expect(tags).toContain(TESTCASE_QUEUE_KIND_TAG)
    })

    it("merges existing tags without duplicates", () => {
        const tags = mergeTestcaseAnnotationTags({
            queueId: "q-1",
            existingTags: ["score", "notes", queueTag("q-1")],
            outputKeys: ["score"],
        })
        expect(tags.filter((t) => t === "score")).toHaveLength(1)
        expect(tags.filter((t) => t === queueTag("q-1"))).toHaveLength(1)
        expect(tags).toContain("notes")
    })

    it("adds output keys as tags", () => {
        const tags = mergeTestcaseAnnotationTags({
            queueId: "q-1",
            outputKeys: ["relevance", "fluency"],
        })
        expect(tags).toContain("relevance")
        expect(tags).toContain("fluency")
    })

    it("handles null existingTags gracefully", () => {
        const tags = mergeTestcaseAnnotationTags({queueId: "q-1", existingTags: null})
        expect(tags).toContain(queueTag("q-1"))
        expect(tags).toContain(TESTCASE_QUEUE_KIND_TAG)
    })

    it("filters out falsy tags from existingTags", () => {
        const tags = mergeTestcaseAnnotationTags({
            queueId: "q-1",
            existingTags: ["", null as unknown as string, "valid-tag"],
        })
        expect(tags).not.toContain("")
        expect(tags).not.toContain(null)
        expect(tags).toContain("valid-tag")
    })
})

// ---------------------------------------------------------------------------
// selectQueueScopedAnnotation
// ---------------------------------------------------------------------------

describe("selectQueueScopedAnnotation — no match", () => {
    it("returns null annotation when list is empty", () => {
        const result = selectQueueScopedAnnotation({
            annotations: [],
            queueId: "q-1",
            evaluatorSlug: "relevance",
        })
        expect(result).toEqual({annotation: null, conflictCode: null})
    })

    it("returns null annotation when no annotation matches the evaluator slug", () => {
        const ann = makeAnnotation({evaluatorSlug: "other-evaluator"})
        const result = selectQueueScopedAnnotation({
            annotations: [ann],
            queueId: "q-1",
            evaluatorSlug: "relevance",
        })
        expect(result).toEqual({annotation: null, conflictCode: null})
    })
})

describe("selectQueueScopedAnnotation — queue-scoped matching", () => {
    it("returns the annotation when exactly one queue-scoped match exists", () => {
        const ann = makeAnnotation({
            evaluatorSlug: "relevance",
            tags: [queueTag("q-1"), TESTCASE_QUEUE_KIND_TAG],
        })
        const result = selectQueueScopedAnnotation({
            annotations: [ann],
            queueId: "q-1",
            evaluatorSlug: "relevance",
        })
        expect(result).toEqual({annotation: ann, conflictCode: null})
    })

    it("returns duplicate_queue_annotations when multiple queue-scoped annotations match", () => {
        const ann1 = makeAnnotation({
            evaluatorSlug: "relevance",
            tags: [queueTag("q-1"), TESTCASE_QUEUE_KIND_TAG],
            traceId: "trace-1",
        })
        const ann2 = makeAnnotation({
            evaluatorSlug: "relevance",
            tags: [queueTag("q-1"), TESTCASE_QUEUE_KIND_TAG],
            traceId: "trace-2",
        })
        const result = selectQueueScopedAnnotation({
            annotations: [ann1, ann2],
            queueId: "q-1",
            evaluatorSlug: "relevance",
        })
        expect(result).toEqual({annotation: null, conflictCode: "duplicate_queue_annotations"})
    })

    it("ignores annotations scoped to a different queue", () => {
        const ann = makeAnnotation({
            evaluatorSlug: "relevance",
            tags: [queueTag("q-OTHER"), TESTCASE_QUEUE_KIND_TAG],
        })
        const result = selectQueueScopedAnnotation({
            annotations: [ann],
            queueId: "q-1",
            evaluatorSlug: "relevance",
        })
        // Not a queue-scoped match for q-1, and it has a queue tag → not legacy either
        expect(result.annotation).toBeNull()
        expect(result.conflictCode).toBeNull()
    })
})

describe("selectQueueScopedAnnotation — legacy fallback", () => {
    it("falls back to a legacy annotation (no queue tags) when no queue-scoped match", () => {
        const ann = makeAnnotation({
            evaluatorSlug: "relevance",
            tags: [], // no queue tags → legacy
        })
        const result = selectQueueScopedAnnotation({
            annotations: [ann],
            queueId: "q-1",
            evaluatorSlug: "relevance",
        })
        expect(result).toEqual({annotation: ann, conflictCode: null})
    })

    it("returns duplicate_legacy_annotations when multiple legacy annotations match", () => {
        const ann1 = makeAnnotation({evaluatorSlug: "relevance", tags: [], traceId: "trace-1"})
        const ann2 = makeAnnotation({evaluatorSlug: "relevance", tags: [], traceId: "trace-2"})
        const result = selectQueueScopedAnnotation({
            annotations: [ann1, ann2],
            queueId: "q-1",
            evaluatorSlug: "relevance",
        })
        expect(result).toEqual({annotation: null, conflictCode: "duplicate_legacy_annotations"})
    })
})

describe("selectQueueScopedAnnotation — evaluatorWorkflowId matching", () => {
    it("matches annotation by evaluator workflow ID", () => {
        const ann = makeAnnotation({
            evaluatorId: "wf-abc",
            tags: [queueTag("q-1"), TESTCASE_QUEUE_KIND_TAG],
        })
        const result = selectQueueScopedAnnotation({
            annotations: [ann],
            queueId: "q-1",
            evaluatorSlug: "relevance",
            evaluatorWorkflowId: "wf-abc",
        })
        expect(result).toEqual({annotation: ann, conflictCode: null})
    })
})

// ---------------------------------------------------------------------------
// getTestsetSyncEvaluatorColumnKey
// ---------------------------------------------------------------------------

describe("getTestsetSyncEvaluatorColumnKey", () => {
    const evaluator = {slug: "relevance", workflowId: "wf-1"}

    it("returns evaluator slug when no annotation supplied", () => {
        expect(getTestsetSyncEvaluatorColumnKey({evaluator})).toBe("relevance")
    })

    it("prefers annotation's evaluator slug over evaluator.slug", () => {
        const ann = makeAnnotation({evaluatorSlug: "resolved-slug"})
        expect(getTestsetSyncEvaluatorColumnKey({evaluator, annotation: ann})).toBe("resolved-slug")
    })

    it("falls back to evaluator.workflowId when slug is empty", () => {
        const noSlugEval = {slug: "", workflowId: "wf-fallback"}
        expect(getTestsetSyncEvaluatorColumnKey({evaluator: noSlugEval})).toBe("wf-fallback")
    })

    it("returns empty string when evaluator has no slug or workflowId", () => {
        expect(getTestsetSyncEvaluatorColumnKey({evaluator: {slug: "", workflowId: ""}})).toBe("")
    })
})

// ---------------------------------------------------------------------------
// buildTestsetSyncOperations
// ---------------------------------------------------------------------------

describe("buildTestsetSyncOperations", () => {
    it("maps target rows to replace operations", () => {
        const target = {
            testsetId: "ts-1",
            baseRevisionId: "rev-1",
            rowCount: 2,
            rows: [
                {
                    scenarioId: "s-1",
                    testcaseId: "tc-1",
                    testsetId: "ts-1",
                    rowId: "r-1",
                    data: {x: 1},
                },
                {
                    scenarioId: "s-2",
                    testcaseId: "tc-2",
                    testsetId: "ts-1",
                    rowId: "r-2",
                    data: {x: 2},
                },
            ],
        }

        const ops = buildTestsetSyncOperations(target)
        expect(ops).toEqual({
            rows: {
                replace: [
                    {id: "r-1", data: {x: 1}},
                    {id: "r-2", data: {x: 2}},
                ],
            },
        })
    })

    it("produces an empty replace list for a target with no rows", () => {
        const ops = buildTestsetSyncOperations({
            testsetId: "ts-1",
            baseRevisionId: "rev-1",
            rowCount: 0,
            rows: [],
        })
        expect(ops.rows.replace).toHaveLength(0)
    })
})

// ---------------------------------------------------------------------------
// remapTargetRowsToBaseRevision
// ---------------------------------------------------------------------------

describe("remapTargetRowsToBaseRevision", () => {
    it("keeps rows whose rowId exists directly in baseRows", () => {
        const target = {
            testsetId: "ts-1",
            baseRevisionId: "rev-1",
            rowCount: 1,
            rows: [
                {scenarioId: "s-1", testcaseId: "tc-1", testsetId: "ts-1", rowId: "r-1", data: {}},
            ],
        }
        const {target: result, droppedRowCount} = remapTargetRowsToBaseRevision({
            target,
            baseRows: [{id: "r-1"}],
        })
        expect(result.rows).toHaveLength(1)
        expect(result.rows[0].rowId).toBe("r-1")
        expect(droppedRowCount).toBe(0)
    })

    it("remaps a row using testcase_dedup_id when rowId is not in baseRows", () => {
        const target = {
            testsetId: "ts-1",
            baseRevisionId: "rev-1",
            rowCount: 1,
            rows: [
                {
                    scenarioId: "s-1",
                    testcaseId: "tc-1",
                    testsetId: "ts-1",
                    rowId: "old-id",
                    data: {testcase_dedup_id: "dedup-abc"},
                },
            ],
        }
        const {target: result, droppedRowCount} = remapTargetRowsToBaseRevision({
            target,
            baseRows: [{id: "new-id", data: {testcase_dedup_id: "dedup-abc"}}],
        })
        expect(result.rows[0].rowId).toBe("new-id")
        expect(droppedRowCount).toBe(0)
    })

    it("also remaps using legacy __dedup_id__ key", () => {
        const target = {
            testsetId: "ts-1",
            baseRevisionId: "rev-1",
            rowCount: 1,
            rows: [
                {
                    scenarioId: "s-1",
                    testcaseId: "tc-1",
                    testsetId: "ts-1",
                    rowId: "old-id",
                    data: {__dedup_id__: "dedup-xyz"},
                },
            ],
        }
        const {target: result, droppedRowCount} = remapTargetRowsToBaseRevision({
            target,
            baseRows: [{id: "mapped-id", data: {__dedup_id__: "dedup-xyz"}}],
        })
        expect(result.rows[0].rowId).toBe("mapped-id")
        expect(droppedRowCount).toBe(0)
    })

    it("drops rows with no matching rowId and no dedup key", () => {
        const target = {
            testsetId: "ts-1",
            baseRevisionId: "rev-1",
            rowCount: 1,
            rows: [
                {scenarioId: "s-1", testcaseId: "tc-1", testsetId: "ts-1", rowId: "gone", data: {}},
            ],
        }
        const {target: result, droppedRowCount} = remapTargetRowsToBaseRevision({
            target,
            baseRows: [{id: "other-id"}],
        })
        expect(result.rows).toHaveLength(0)
        expect(droppedRowCount).toBe(1)
    })

    it("updates rowCount to reflect mapped rows only", () => {
        const target = {
            testsetId: "ts-1",
            baseRevisionId: "rev-1",
            rowCount: 2,
            rows: [
                {scenarioId: "s-1", testcaseId: "tc-1", testsetId: "ts-1", rowId: "r-1", data: {}},
                {scenarioId: "s-2", testcaseId: "tc-2", testsetId: "ts-1", rowId: "gone", data: {}},
            ],
        }
        const {target: result, droppedRowCount} = remapTargetRowsToBaseRevision({
            target,
            baseRows: [{id: "r-1"}],
        })
        expect(result.rowCount).toBe(1)
        expect(droppedRowCount).toBe(1)
    })
})

// ---------------------------------------------------------------------------
// buildTraceTestsetRows
// ---------------------------------------------------------------------------

describe("buildTraceTestsetRows", () => {
    it("builds a row per scenario with trace inputs and output", () => {
        const rows = buildTraceTestsetRows({
            scenarioIds: ["s-1"],
            traceInputsByScenario: new Map([["s-1", {question: "What is AI?"}]]),
            traceOutputsByScenario: new Map([["s-1", "AI is..."]]),
            annotationsByScenario: new Map(),
            outputColumnName: "answer",
        })
        expect(rows).toHaveLength(1)
        expect(rows[0].scenarioId).toBe("s-1")
        expect(rows[0].data.question).toBe("What is AI?")
        expect(rows[0].data.answer).toBe("AI is...")
    })

    it("expands a nested 'inputs' key into top-level columns", () => {
        const rows = buildTraceTestsetRows({
            scenarioIds: ["s-1"],
            traceInputsByScenario: new Map([["s-1", {inputs: {a: 1, b: 2}}]]),
            traceOutputsByScenario: new Map(),
            annotationsByScenario: new Map(),
            outputColumnName: "output",
        })
        expect(rows[0].data.a).toBe(1)
        expect(rows[0].data.b).toBe(2)
        expect(rows[0].data).not.toHaveProperty("inputs")
    })

    it("merges annotation outputs into the row", () => {
        const rows = buildTraceTestsetRows({
            scenarioIds: ["s-1"],
            traceInputsByScenario: new Map([["s-1", {q: "hi"}]]),
            traceOutputsByScenario: new Map([["s-1", "hello"]]),
            annotationsByScenario: new Map([["s-1", {relevance: {score: 5}}]]),
            outputColumnName: "output",
        })
        expect(rows[0].data.relevance).toMatchObject({score: 5})
    })

    it("handles a missing scenario gracefully (uses empty defaults)", () => {
        const rows = buildTraceTestsetRows({
            scenarioIds: ["s-missing"],
            traceInputsByScenario: new Map(),
            traceOutputsByScenario: new Map(),
            annotationsByScenario: new Map(),
            outputColumnName: "output",
        })
        expect(rows).toHaveLength(1)
        expect(rows[0].data.output).toBeUndefined()
    })
})

// ---------------------------------------------------------------------------
// buildTestcaseExportRows
// ---------------------------------------------------------------------------

describe("buildTestcaseExportRows", () => {
    const evaluator = {slug: "quality", workflowId: "wf-q"}

    function makeTestcase(id: string, testsetId: string) {
        return {id, testset_id: testsetId, data: {prompt: "hello"}}
    }

    it("builds a row when annotation data exists for the testcase", () => {
        const ann = makeAnnotation({
            evaluatorSlug: "quality",
            tags: [queueTag("q-1"), TESTCASE_QUEUE_KIND_TAG],
            outputs: {score: 8},
        })
        const rows = buildTestcaseExportRows({
            scenarioIds: ["s-1"],
            testcasesByScenarioId: new Map([["s-1", makeTestcase("tc-1", "ts-1") as any]]),
            annotationsByTestcaseId: new Map([["tc-1", [ann]]]),
            evaluators: [evaluator],
            queueId: "q-1",
        })
        expect(rows).toHaveLength(1)
        expect(rows[0].testcaseId).toBe("tc-1")
        expect(rows[0].testsetId).toBe("ts-1")
        expect((rows[0].data as any).quality).toMatchObject({score: 8})
    })

    it("skips a scenario with no testcase mapping", () => {
        const rows = buildTestcaseExportRows({
            scenarioIds: ["s-missing"],
            testcasesByScenarioId: new Map(),
            annotationsByTestcaseId: new Map(),
            evaluators: [evaluator],
            queueId: "q-1",
        })
        expect(rows).toHaveLength(0)
    })

    it("skips a testcase with no annotations", () => {
        const rows = buildTestcaseExportRows({
            scenarioIds: ["s-1"],
            testcasesByScenarioId: new Map([["s-1", makeTestcase("tc-1", "ts-1") as any]]),
            annotationsByTestcaseId: new Map([["tc-1", []]]),
            evaluators: [evaluator],
            queueId: "q-1",
        })
        expect(rows).toHaveLength(0)
    })
})

// ---------------------------------------------------------------------------
// buildTestsetSyncPreview
// ---------------------------------------------------------------------------

describe("buildTestsetSyncPreview", () => {
    const evaluator = {slug: "quality", workflowId: "wf-q"}

    function makeTestcase(id: string, testsetId: string) {
        return {id, testset_id: testsetId, data: {}}
    }

    function makeQueueAnn(traceId = "trace-1") {
        return makeAnnotation({
            evaluatorSlug: "quality",
            tags: [queueTag("q-1"), TESTCASE_QUEUE_KIND_TAG],
            outputs: {score: 7},
            traceId,
        })
    }

    it("returns a missing_testcase conflict when testcase not found", () => {
        const preview = buildTestsetSyncPreview({
            queueId: "q-1",
            completedScenarios: [{scenarioId: "s-1", testcaseId: "tc-missing"}],
            testcasesById: new Map(),
            annotationsByTestcaseId: new Map(),
            evaluators: [evaluator],
            latestRevisionIdsByTestsetId: new Map(),
        })
        expect(preview.conflicts).toHaveLength(1)
        expect(preview.conflicts[0].code).toBe("missing_testcase")
        expect(preview.hasBlockingConflicts).toBe(true)
    })

    it("returns a missing_testset conflict when testcase has no testset_id", () => {
        const preview = buildTestsetSyncPreview({
            queueId: "q-1",
            completedScenarios: [{scenarioId: "s-1", testcaseId: "tc-1"}],
            testcasesById: new Map([["tc-1", {id: "tc-1", data: {}} as any]]),
            annotationsByTestcaseId: new Map(),
            evaluators: [evaluator],
            latestRevisionIdsByTestsetId: new Map(),
        })
        expect(preview.conflicts[0].code).toBe("missing_testset")
    })

    it("returns a missing_latest_revision conflict when no revision for testset", () => {
        const ann = makeQueueAnn()
        const preview = buildTestsetSyncPreview({
            queueId: "q-1",
            completedScenarios: [{scenarioId: "s-1", testcaseId: "tc-1"}],
            testcasesById: new Map([["tc-1", makeTestcase("tc-1", "ts-1") as any]]),
            annotationsByTestcaseId: new Map([["tc-1", [ann]]]),
            evaluators: [evaluator],
            latestRevisionIdsByTestsetId: new Map(), // ts-1 has no revision
        })
        expect(preview.conflicts.some((c) => c.code === "missing_latest_revision")).toBe(true)
    })

    it("produces a clean target when everything is resolved", () => {
        const ann = makeQueueAnn()
        const preview = buildTestsetSyncPreview({
            queueId: "q-1",
            completedScenarios: [{scenarioId: "s-1", testcaseId: "tc-1"}],
            testcasesById: new Map([["tc-1", makeTestcase("tc-1", "ts-1") as any]]),
            annotationsByTestcaseId: new Map([["tc-1", [ann]]]),
            evaluators: [evaluator],
            latestRevisionIdsByTestsetId: new Map([["ts-1", "rev-1"]]),
        })
        expect(preview.conflicts).toHaveLength(0)
        expect(preview.targets).toHaveLength(1)
        expect(preview.targets[0].testsetId).toBe("ts-1")
        expect(preview.targets[0].baseRevisionId).toBe("rev-1")
        expect(preview.exportableRows).toBe(1)
        expect(preview.hasBlockingConflicts).toBe(false)
    })

    it("records duplicate_queue_annotations conflict and skips the row", () => {
        const ann1 = makeQueueAnn("trace-1")
        const ann2 = makeQueueAnn("trace-2")
        const preview = buildTestsetSyncPreview({
            queueId: "q-1",
            completedScenarios: [{scenarioId: "s-1", testcaseId: "tc-1"}],
            testcasesById: new Map([["tc-1", makeTestcase("tc-1", "ts-1") as any]]),
            annotationsByTestcaseId: new Map([["tc-1", [ann1, ann2]]]),
            evaluators: [evaluator],
            latestRevisionIdsByTestsetId: new Map([["ts-1", "rev-1"]]),
        })
        expect(preview.conflicts[0].code).toBe("duplicate_queue_annotations")
        expect(preview.exportableRows).toBe(0)
        expect(preview.hasBlockingConflicts).toBe(true)
    })

    it("groups rows from different scenarios under the same testset target", () => {
        const ann1 = makeQueueAnn("trace-1")
        const ann2 = makeQueueAnn("trace-2")
        const preview = buildTestsetSyncPreview({
            queueId: "q-1",
            completedScenarios: [
                {scenarioId: "s-1", testcaseId: "tc-1"},
                {scenarioId: "s-2", testcaseId: "tc-2"},
            ],
            testcasesById: new Map([
                ["tc-1", makeTestcase("tc-1", "ts-1") as any],
                ["tc-2", makeTestcase("tc-2", "ts-1") as any],
            ]),
            annotationsByTestcaseId: new Map([
                ["tc-1", [ann1]],
                ["tc-2", [ann2]],
            ]),
            evaluators: [evaluator],
            latestRevisionIdsByTestsetId: new Map([["ts-1", "rev-1"]]),
        })
        expect(preview.targets).toHaveLength(1)
        expect(preview.targets[0].rowCount).toBe(2)
        expect(preview.exportableRows).toBe(2)
    })

    it("skips rows with no annotation data and does not add them as conflicts", () => {
        const annNoOutputs = makeAnnotation({
            evaluatorSlug: "quality",
            tags: [queueTag("q-1"), TESTCASE_QUEUE_KIND_TAG],
            outputs: {}, // empty
        })
        const preview = buildTestsetSyncPreview({
            queueId: "q-1",
            completedScenarios: [{scenarioId: "s-1", testcaseId: "tc-1"}],
            testcasesById: new Map([["tc-1", makeTestcase("tc-1", "ts-1") as any]]),
            annotationsByTestcaseId: new Map([["tc-1", [annNoOutputs]]]),
            evaluators: [evaluator],
            latestRevisionIdsByTestsetId: new Map([["ts-1", "rev-1"]]),
        })
        expect(preview.conflicts).toHaveLength(0)
        expect(preview.exportableRows).toBe(0)
    })
})
