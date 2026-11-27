/**
 * A span's annotations as one result per evaluator and origin, for the side panel's Annotations
 * section. Pure: no React.
 *
 * @packageDocumentation
 */

import type {AnnotationDto} from "@agenta/entities/annotation/dto"
import {
    assertionSummary,
    sortEvaluatorResults,
    splitByOrigin,
    summarizeEvaluatorResult,
    type EvaluatorResultSummary,
} from "@agenta/entities/evaluationRun"

/** One metric of an annotation, by its name. */
export interface AnnotationResultMetric {
    name: string
    value: unknown
}

/** Who made an annotation, and when it was last changed (an ISO date). */
export interface AnnotationResultAuthor {
    userId: string | null
    at: string | null
}

/** The props of the `AnnotationResultRow` slot: one annotation of the span. */
export interface AnnotationResultRowProps {
    evaluatorName: string
    /** How the annotation was made: `auto`, `human` or `custom`; null when not stored. */
    origin: string | null
    metrics: AnnotationResultMetric[]
    author: AnnotationResultAuthor
}

export interface AnnotationResult extends AnnotationResultRowProps {
    /** Unique in one span. */
    key: string
    /** The row rule's summary, with each kind read from the value (no run catalog here). */
    summary: EvaluatorResultSummary
}

/** The Annotations header: the evaluator count and, with binary metrics, the passed count. */
export interface AnnotationResultsHeader {
    evaluators: number
    passed: {passed: number; total: number} | null
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value)

const text = (value: unknown): string | null => (typeof value === "string" && value ? value : null)

const OUTPUT_PARTS = ["metrics", "notes", "extra"] as const

/**
 * The metrics of one annotation: its `metrics`, `notes` and `extra` outputs, flattened. Outputs
 * stored without those parts are the metrics themselves.
 */
const metricsOf = (annotation: AnnotationDto): AnnotationResultMetric[] => {
    const outputs: Record<string, unknown> = isRecord(annotation.data?.outputs)
        ? annotation.data.outputs
        : {}
    const merged: Record<string, unknown> = {}
    if (OUTPUT_PARTS.some((part) => part in outputs)) {
        for (const part of OUTPUT_PARTS) {
            const values = outputs[part]
            if (isRecord(values)) Object.assign(merged, values)
        }
    } else {
        Object.assign(merged, outputs)
    }
    return Object.entries(merged)
        .filter(([, value]) => value !== undefined && value !== null)
        .map(([name, value]) => ({name, value}))
}

/** The stored dates come with the record; the store adds only a formatted day. */
const authorOf = (annotation: AnnotationDto): AnnotationResultAuthor => {
    const raw = annotation as AnnotationDto & {
        created_by_id?: string
        created_at?: string
        updated_at?: string
    }
    return {
        userId: text(raw.createdById) ?? text(raw.created_by_id),
        at: text(raw.updated_at) ?? text(raw.created_at),
    }
}

/**
 * One result per annotation record, failed first (the evaluator row rule's order). `names` maps
 * an evaluator slug to its name; a slug with no name shows the slug. An annotation with no
 * evaluator or no metric has no result.
 */
export function annotationResults(
    annotations: readonly AnnotationDto[] | null | undefined,
    names: ReadonlyMap<string, string> = new Map(),
): AnnotationResult[] {
    const results = (annotations ?? []).flatMap((annotation, index): AnnotationResult[] => {
        const slug = annotation.references?.evaluator?.slug
        const metrics = metricsOf(annotation)
        if (!slug || metrics.length === 0) return []
        return [
            {
                key: `${slug}:${annotation.id ?? annotation.span_id ?? ""}:${index}`,
                evaluatorName: names.get(slug) ?? slug,
                origin: typeof annotation.origin === "string" ? annotation.origin : null,
                metrics,
                author: authorOf(annotation),
                summary: summarizeEvaluatorResult(
                    metrics.map((metric) => ({...metric, kind: null})),
                    "done",
                ),
            },
        ]
    })
    return sortEvaluatorResults(results.map((result) => ({...result, name: result.evaluatorName})))
}

/**
 * The header of the Annotations section. `passed` counts the true binary metrics of the
 * annotations that are not human (`splitByOrigin`): human values are not part of
 * "Passed X of Y". It is null when none of those metrics is true or false.
 */
export function annotationResultsHeader(
    results: readonly AnnotationResult[],
): AnnotationResultsHeader {
    const summary = assertionSummary(
        splitByOrigin(results).notHuman.map((result) => result.summary),
    )
    return {
        evaluators: new Set(results.map((result) => result.evaluatorName)).size,
        passed:
            summary.kind === "assertions" ? {passed: summary.passed, total: summary.total} : null,
    }
}
