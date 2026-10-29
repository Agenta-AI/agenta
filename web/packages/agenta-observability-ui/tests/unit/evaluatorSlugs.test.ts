import type {TraceSpanNode} from "@agenta/entities/trace"
import {describe, expect, it} from "vitest"

import {
    collectEvaluatorSlugsFromTraces,
    orderEvaluatorSlugs,
} from "../../src/columns/useEvaluatorSlugs"

/**
 * This derivation lived in web/oss, so `/m` hardcoded `[]` and silently showed no evaluator
 * columns — and, once the CSV learned to export them, no evaluator headers either. It is shared
 * now, which means both surfaces depend on these two rules holding.
 */

const span = (metrics: Record<string, unknown> | undefined, children?: unknown[]) =>
    ({aggregatedEvaluatorMetrics: metrics, children}) as unknown as TraceSpanNode

describe("collectEvaluatorSlugsFromTraces", () => {
    it("reads slugs off the span's aggregated metrics", () => {
        expect(collectEvaluatorSlugsFromTraces([span({accuracy: {}, toxicity: {}})])).toEqual([
            "accuracy",
            "toxicity",
        ])
    })

    it("finds metrics on a descendant, not just the root", () => {
        const tree = span(undefined, [span(undefined, [span({nested: {}})])])
        expect(collectEvaluatorSlugsFromTraces([tree])).toEqual(["nested"])
    })

    it("dedupes across traces", () => {
        expect(
            collectEvaluatorSlugsFromTraces([span({accuracy: {}}), span({accuracy: {}})]),
        ).toEqual(["accuracy"])
    })

    it("is empty for rows carrying no metrics", () => {
        expect(collectEvaluatorSlugsFromTraces([span(undefined)])).toEqual([])
    })
})

describe("orderEvaluatorSlugs", () => {
    it("keeps the project's annotation order for slugs the rows actually have", () => {
        expect(orderEvaluatorSlugs(["b", "a", "c"], ["a", "b", "c"])).toEqual(["b", "a", "c"])
    })

    it("drops annotation slugs no loaded row carries, so no empty column appears", () => {
        expect(orderEvaluatorSlugs(["a", "ghost"], ["a"])).toEqual(["a"])
    })

    it("appends row-only slugs sorted, so column order is stable across renders", () => {
        expect(orderEvaluatorSlugs(["a"], ["a", "z", "m"])).toEqual(["a", "m", "z"])
    })

    it("is empty when neither side has anything", () => {
        expect(orderEvaluatorSlugs([], [])).toEqual([])
    })
})
