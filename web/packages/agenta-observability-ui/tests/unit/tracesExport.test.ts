import type {ColumnDefs} from "@agenta/ui/table"
import {describe, expect, it, vi} from "vitest"

const queryAllAnnotations = vi.fn()
vi.mock("@agenta/entities/annotation/dto", () => ({
    queryAllAnnotations: (...args: unknown[]) => queryAllAnnotations(...args),
    groupAnnotationsByReferenceId: (annotations: {slug: string; metrics: unknown}[]) =>
        Object.fromEntries(annotations.map((a) => [a.slug, a.metrics])),
}))

const {collectEvaluatorSlugs, formatEvaluatorMetrics, makeEvaluatorMetricsEnrichment} =
    await import("../../src/table/useTracesExport")

/**
 * Evaluator columns used to vanish from the CSV without a word: their metrics live on linked
 * annotations rather than on the span, and their leaf columns carry `title: null` (the header
 * cell is hidden, the cell draws its own label), so the title-based header selection could not
 * see them at all. Their KEYS are the evaluator slugs, which is the hook the export needs.
 */

interface Row {
    key: string
    [k: string]: unknown
}

const columns = [
    {title: "Name", key: "name", dataIndex: "name"},
    {
        title: "Evaluators",
        key: "evaluators",
        children: [
            {title: null, key: "accuracy"},
            {title: null, key: "toxicity"},
        ],
    },
    {title: "Cost", key: "cost", dataIndex: "cost"},
] as unknown as ColumnDefs<Row>

describe("collectEvaluatorSlugs", () => {
    it("finds title-less evaluator leaves by key", () => {
        expect(collectEvaluatorSlugs(columns)).toEqual(["accuracy", "toxicity"])
    })

    it("returns nothing when the evaluators group is not present", () => {
        const withoutEvaluators = columns.filter(
            (column) => String((column as {key?: unknown}).key) !== "evaluators",
        ) as ColumnDefs<Row>
        expect(collectEvaluatorSlugs(withoutEvaluators)).toEqual([])
    })

    it("does not mistake another group's children for evaluators", () => {
        const other = [
            {title: "Usage", key: "usage", children: [{title: "Tokens", key: "tokens"}]},
        ] as unknown as ColumnDefs<Row>
        expect(collectEvaluatorSlugs(other)).toEqual([])
    })
})

describe("formatEvaluatorMetrics", () => {
    it("reads booleans as their latest value and numbers as the average, like the cell", () => {
        expect(formatEvaluatorMetrics({passed: {latest: true}, score: {average: 0.82}})).toBe(
            "passed: True; score: 0.82",
        )
    })

    it("keeps a false boolean rather than dropping it", () => {
        expect(formatEvaluatorMetrics({passed: {latest: false}})).toBe("passed: False")
    })

    it("is empty for a trace with no annotations, so the column stays aligned", () => {
        expect(formatEvaluatorMetrics(undefined)).toBe("")
    })
})

const chunkOf = (items: unknown[]) => ({items, cursor: null}) as never

describe("makeEvaluatorMetricsEnrichment", () => {
    it("makes ONE annotations request per chunk, not one per row", async () => {
        queryAllAnnotations.mockReset()
        queryAllAnnotations.mockResolvedValue({annotations: []})

        const enrich = makeEvaluatorMetricsEnrichment({
            evaluatorSlugs: ["accuracy"],
            projectId: "p1",
        })
        await enrich(
            chunkOf([
                {trace_id: "t1", span_id: "s1"},
                {trace_id: "t2", span_id: "s2"},
                {trace_id: "t3", span_id: "s3"},
            ]),
        )

        expect(queryAllAnnotations).toHaveBeenCalledTimes(1)
        expect(queryAllAnnotations.mock.calls[0][0].queries.annotation.links).toHaveLength(3)
    })

    it("attaches each span's own metrics, matched through the annotation link", async () => {
        queryAllAnnotations.mockReset()
        queryAllAnnotations.mockResolvedValue({
            annotations: [
                {
                    links: {invocation: {trace_id: "t1", span_id: "s1"}},
                    slug: "accuracy",
                    metrics: {score: {average: 0.9}},
                },
            ],
        })

        const enrich = makeEvaluatorMetricsEnrichment({evaluatorSlugs: ["accuracy"]})
        const out = await enrich(
            chunkOf([
                {trace_id: "t1", span_id: "s1"},
                {trace_id: "t2", span_id: "s2"},
            ]),
        )

        const items = (out as unknown as {items: Record<string, never>[]}).items
        expect(items[0].__evaluatorMetrics).toEqual({accuracy: "score: 0.9"})
        // The unannotated span still gets the key, so its CSV cell stays aligned.
        expect(items[1].__evaluatorMetrics).toEqual({accuracy: ""})
    })

    it("keeps the rows when the annotations request fails", async () => {
        queryAllAnnotations.mockReset()
        queryAllAnnotations.mockRejectedValue(new Error("boom"))
        const spy = vi.spyOn(console, "error").mockImplementation(() => {})

        const enrich = makeEvaluatorMetricsEnrichment({evaluatorSlugs: ["accuracy"]})
        const out = await enrich(chunkOf([{trace_id: "t1", span_id: "s1"}]))

        spy.mockRestore()
        expect((out as unknown as {items: unknown[]}).items).toHaveLength(1)
    })

    it("skips the request entirely when no row carries a usable link", async () => {
        queryAllAnnotations.mockReset()
        const enrich = makeEvaluatorMetricsEnrichment({evaluatorSlugs: ["accuracy"]})
        await enrich(chunkOf([{trace_id: "", span_id: ""}]))
        expect(queryAllAnnotations).not.toHaveBeenCalled()
    })
})
