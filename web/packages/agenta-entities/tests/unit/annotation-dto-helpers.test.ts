import {describe, expect, it} from "vitest"

import {
    attachAnnotationsToTraces,
    groupAnnotationsByReferenceId,
    groupOutputValues,
} from "../../src/annotation/dto/helpers"
import type {AnnotationDto} from "../../src/annotation/dto/types"
import {getNodeById} from "../../src/trace/utils/nodeTree"

const annotation = (
    slug: string,
    metrics: Record<string, unknown>,
    link?: {trace_id: string; span_id: string},
    createdBy = "alice",
): AnnotationDto =>
    ({
        references: {evaluator: {slug}},
        data: {outputs: {metrics}},
        createdBy,
        ...(link ? {links: {invocation: link}} : {}),
    }) as AnnotationDto

describe("groupOutputValues", () => {
    it("splits outputs by value type and drops nulls", () => {
        expect(
            groupOutputValues({score: 3, ok: true, note: "hi", skip: null, nested: {a: 1}}),
        ).toEqual({
            metrics: {score: 3, ok: true},
            notes: {note: "hi"},
            extra: {nested: {a: 1}},
        })
    })
})

describe("groupAnnotationsByReferenceId", () => {
    it("averages numeric metrics", () => {
        const result = groupAnnotationsByReferenceId([
            annotation("exact", {score: 1}),
            annotation("exact", {score: 2}),
        ])
        expect(result.exact.score.average).toBe(1.5)
        expect(result.exact.score.annotations).toHaveLength(2)
    })

    it("reports a single boolean as latest, not an average", () => {
        const result = groupAnnotationsByReferenceId([annotation("flag", {ok: true})])
        expect(result.flag.ok).toEqual({latest: true, annotations: [{value: true, user: "alice"}]})
    })

    it("averages the true-share once there are multiple booleans", () => {
        const result = groupAnnotationsByReferenceId([
            annotation("flag", {ok: true}),
            annotation("flag", {ok: false}),
            annotation("flag", {ok: true}),
        ])
        expect(result.flag.ok.average).toBe(0.67)
        expect(result.flag.ok.latest).toBeUndefined()
    })

    it("skips mixed types and non-numeric metric values", () => {
        const result = groupAnnotationsByReferenceId([
            annotation("mixed", {m: 1}),
            annotation("mixed", {m: true}),
            annotation("mixed", {m: "text"}),
        ])
        expect(result.mixed.m).toBeUndefined()
    })

    it("ignores annotations with no evaluator slug", () => {
        expect(groupAnnotationsByReferenceId([{data: {outputs: {}}} as AnnotationDto])).toEqual({})
    })
})

describe("attachAnnotationsToTraces", () => {
    const link = {trace_id: "t1", span_id: "s1"}

    it("matches annotations by invocationIds through any link key", () => {
        const [trace] = attachAnnotationsToTraces(
            [{invocationIds: link, name: "root"}],
            [
                {...annotation("exact", {score: 4}), links: {"test-xyz": link}} as AnnotationDto,
                annotation("exact", {score: 9}, {trace_id: "other", span_id: "nope"}),
            ],
        )
        expect(trace.annotations).toHaveLength(1)
        expect(trace.aggregatedEvaluatorMetrics.exact.score.average).toBe(4)
        expect(trace.name).toBe("root")
    })

    it("recurses into children", () => {
        const [trace] = attachAnnotationsToTraces(
            [{invocationIds: {trace_id: "x", span_id: "y"}, children: [{invocationIds: link}]}],
            [annotation("exact", {score: 1}, link)],
        )
        const children = trace.children as {annotations: AnnotationDto[]}[]
        expect(trace.annotations).toHaveLength(0)
        expect(children[0].annotations).toHaveLength(1)
    })
})

describe("getNodeById", () => {
    const tree = [
        {span_id: "a", children: [{span_id: "a1"}, {span_id: "a2", children: [{span_id: "a2x"}]}]},
        {span_id: "b"},
    ]

    it("finds a top-level node", () => {
        expect(getNodeById(tree, "b")).toEqual({span_id: "b"})
    })

    it("finds a deeply nested node", () => {
        expect(getNodeById(tree, "a2x")).toEqual({span_id: "a2x"})
    })

    it("returns the node itself when passed a single matching span", () => {
        expect(getNodeById({span_id: "solo"}, "solo")).toEqual({span_id: "solo"})
    })

    it("returns null when absent, and tolerates empty input", () => {
        expect(getNodeById(tree, "missing")).toBeNull()
        expect(getNodeById([], "a")).toBeNull()
        expect(getNodeById(null, "a")).toBeNull()
    })
})
