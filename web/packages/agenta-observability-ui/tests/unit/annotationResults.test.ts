import type {AnnotationDto} from "@agenta/entities/annotation/dto"
import {describe, expect, it} from "vitest"

import {annotationResults, annotationResultsHeader} from "../../src/traceDrawer/annotationResults"

const annotation = (slug: string, origin: string, outputs: Record<string, unknown>) =>
    ({
        references: {evaluator: {slug}},
        origin,
        data: {outputs},
    }) as unknown as AnnotationDto

describe("annotationResults", () => {
    it("gives one result per annotation, with its author and last change", () => {
        const results = annotationResults([
            {
                ...annotation("tone", "human", {metrics: {polite: true}}),
                createdById: "user-1",
                created_at: "2026-11-27T08:00:00Z",
            } as unknown as AnnotationDto,
            {
                ...annotation("tone", "human", {metrics: {polite: true}}),
                created_by_id: "user-2",
                created_at: "2026-11-27T08:00:00Z",
                updated_at: "2026-11-27T09:00:00Z",
            } as unknown as AnnotationDto,
        ])
        expect(results.map((result) => result.author)).toEqual([
            {userId: "user-1", at: "2026-11-27T08:00:00Z"},
            {userId: "user-2", at: "2026-11-27T09:00:00Z"},
        ])
        expect(annotationResultsHeader(results).evaluators).toBe(1)
    })

    it("gives one result per annotation, with its metrics and notes", () => {
        const results = annotationResults(
            [
                annotation("faithfulness", "auto", {
                    metrics: {success: true, score: 0.9},
                    notes: {reason: "Matches the ground truth."},
                }),
                annotation("tone", "human", {metrics: {polite: false}}),
            ],
            new Map([["faithfulness", "Faithfulness judge"]]),
        )
        expect(results.map((result) => [result.evaluatorName, result.origin])).toEqual([
            // Failed first.
            ["tone", "human"],
            ["Faithfulness judge", "auto"],
        ])
        expect(results[1].metrics).toEqual([
            {name: "success", value: true},
            {name: "score", value: 0.9},
            {name: "reason", value: "Matches the ground truth."},
        ])
        // The note is a text metric: on expand, not on the row.
        expect(results[1].summary.text.map((metric) => metric.name)).toEqual(["reason"])
    })

    it("reads outputs stored without the metrics, notes and extra parts", () => {
        const [result] = annotationResults([annotation("judge", "auto", {score: 3})])
        expect(result.metrics).toEqual([{name: "score", value: 3}])
    })

    it("has no result for annotations without metrics or an evaluator", () => {
        expect(annotationResults([])).toEqual([])
        expect(annotationResults(null)).toEqual([])
        expect(
            annotationResults([
                annotation("empty", "auto", {metrics: {}}),
                {data: {outputs: {metrics: {a: 1}}}} as unknown as AnnotationDto,
            ]),
        ).toEqual([])
    })

    it("counts passed binary metrics for the header, and none without binary metrics", () => {
        const results = annotationResults([
            annotation("a", "auto", {metrics: {ok: true, safe: false}}),
            annotation("b", "auto", {metrics: {ok: true}}),
        ])
        expect(annotationResultsHeader(results)).toEqual({
            evaluators: 2,
            passed: {passed: 2, total: 3},
        })
        expect(
            annotationResultsHeader(annotationResults([annotation("c", "auto", {score: 0.4})])),
        ).toEqual({evaluators: 1, passed: null})
    })

    it("leaves human values out of the passed count", () => {
        const results = annotationResults([
            annotation("a", "auto", {metrics: {ok: true}}),
            annotation("b", "human", {metrics: {ok: false}}),
        ])
        expect(annotationResultsHeader(results)).toEqual({
            evaluators: 2,
            passed: {passed: 1, total: 1},
        })
    })
})
