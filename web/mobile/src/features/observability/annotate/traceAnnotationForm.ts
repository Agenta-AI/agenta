import {
    getMetricFieldsFromEvaluator,
    getMetricsFromAnnotation,
    getOutputsSchema,
    isEmptyValue,
    type AnnotationMetricField,
} from "@agenta/annotation"
import type {
    Annotation,
    CreateAnnotationPayload,
    UpdateAnnotationPayload,
} from "@agenta/entities/annotation"
import type {AnnotationDto} from "@agenta/entities/annotation/dto"
import type {Workflow} from "@agenta/entities/workflow"

/** The text the single choice "none of the above" option holds; it is saved as `null`. */
const NONE_OF_THE_ABOVE = "null"

/** Edited values by evaluator slug, then metric key. Only the fields the user touched. */
export type TraceAnnotationValues = Record<string, Record<string, unknown>>

export interface TraceAnnotationSection {
    slug: string
    workflowId: string
    name: string
    description: string
    /** The user's own annotation this section edits, or null for a new annotation. */
    own: AnnotationDto | null
    /** The metric fields with their saved (own) or default (new) values. */
    fields: Record<string, AnnotationMetricField>
    required: string[]
}

export interface TraceAnnotationUpdate {
    traceId: string
    spanId: string | undefined
    annotation: UpdateAnnotationPayload["annotation"]
}

export interface TraceAnnotationWrites {
    creates: CreateAnnotationPayload[]
    updates: TraceAnnotationUpdate[]
    /** Required metric keys left empty, by evaluator slug. Any entry blocks the whole save. */
    missingRequired: Record<string, string[]>
}

const slugOf = (annotation: AnnotationDto) => annotation.references?.evaluator?.slug

/** Newest first. The raw `created_at` keeps the time; `createdAt` is the shown day only. */
const createdTime = (annotation: AnnotationDto) => {
    const raw = (annotation as {created_at?: string}).created_at ?? annotation.createdAt
    const time = raw ? new Date(raw).getTime() : 0
    return Number.isNaN(time) ? 0 : time
}

const isOwnWebAnnotation = (annotation: AnnotationDto, userId: string) =>
    annotation.createdById === userId &&
    annotation.channel === "web" &&
    annotation.origin === "human" &&
    annotation.kind === "adhoc"

/**
 * Splits a span's annotations into the ones the form edits (the user's newest own web human
 * annotation per evaluator) and the evaluators other people annotated by hand, which the form
 * offers as new empty sections. Automatic annotations add nothing.
 */
export const pickEditableAnnotations = ({
    annotations,
    userId,
}: {
    annotations: readonly AnnotationDto[]
    userId: string | null | undefined
}): {own: AnnotationDto[]; otherSlugs: string[]} => {
    const newestFirst = [...annotations].sort((a, b) => createdTime(b) - createdTime(a))
    const own = new Map<string, AnnotationDto>()
    const others = new Set<string>()

    for (const annotation of newestFirst) {
        const slug = slugOf(annotation)
        if (!slug) continue
        if (userId && isOwnWebAnnotation(annotation, userId)) {
            if (!own.has(slug)) own.set(slug, annotation)
        } else if (annotation.origin === "human" || annotation.channel === "web") {
            others.add(slug)
        }
    }

    return {
        own: [...own.values()],
        otherSlugs: [...others].filter((slug) => !own.has(slug)),
    }
}

/** One form section per slug, in the given order, with the saved or default values. */
export const buildTraceAnnotationSections = ({
    slugs,
    evaluators,
    own,
}: {
    slugs: readonly string[]
    evaluators: ReadonlyMap<string, {workflowId: string; revision: Workflow}>
    own: readonly AnnotationDto[]
}): TraceAnnotationSection[] => {
    const ownBySlug = new Map(own.map((annotation) => [slugOf(annotation), annotation]))

    return slugs.flatMap((slug) => {
        const evaluator = evaluators.get(slug)
        if (!evaluator) return []
        const {workflowId, revision} = evaluator
        const ownAnnotation = ownBySlug.get(slug) ?? null
        return [
            {
                slug,
                workflowId,
                name: revision.name || slug,
                description: revision.description ?? "",
                own: ownAnnotation,
                fields: ownAnnotation
                    ? getMetricsFromAnnotation(ownAnnotation as unknown as Annotation, revision)
                    : getMetricFieldsFromEvaluator(revision),
                required: getOutputsSchema(revision).required ?? [],
            },
        ]
    })
}

/** Key-order independent comparison of two plain JSON values. */
const sameValue = (a: unknown, b: unknown): boolean => {
    if (a === b) return true
    if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false
    if (Array.isArray(a) !== Array.isArray(b)) return false
    const aKeys = Object.keys(a)
    const bKeys = Object.keys(b)
    if (aKeys.length !== bKeys.length) return false
    return aKeys.every((key) =>
        sameValue((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]),
    )
}

const isSingleChoice = (field: AnnotationMetricField) => Array.isArray(field.type)

/**
 * Turns the form into the requests a save sends: an update for each own annotation whose values
 * changed, and a create for each new section with at least one value. A section that would be
 * saved with a required metric left empty is reported in `missingRequired` instead.
 */
export const buildTraceAnnotationWrites = ({
    sections,
    values,
    traceId,
    spanId,
}: {
    sections: readonly TraceAnnotationSection[]
    values: TraceAnnotationValues
    traceId: string | undefined
    spanId: string | undefined
}): TraceAnnotationWrites => {
    const writes: TraceAnnotationWrites = {creates: [], updates: [], missingRequired: {}}

    for (const section of sections) {
        const edits = values[section.slug] ?? {}
        const current: Record<string, unknown> = {}
        const saved: Record<string, unknown> = {}
        for (const [key, field] of Object.entries(section.fields)) {
            saved[key] = field.value
            current[key] = key in edits ? edits[key] : field.value
        }

        const changed = section.own
            ? !sameValue(current, saved)
            : Object.values(current).some((value) => !isEmptyValue(value))
        if (!changed) continue

        const missing = section.required.filter(
            (key) => key in section.fields && isEmptyValue(current[key]),
        )
        if (missing.length > 0) {
            writes.missingRequired[section.slug] = missing
            continue
        }

        const outputs: Record<string, unknown> = {}
        for (const [key, value] of Object.entries(current)) {
            if (isEmptyValue(value)) continue
            outputs[key] =
                value === NONE_OF_THE_ABOVE && isSingleChoice(section.fields[key]) ? null : value
        }

        if (section.own) {
            if (!section.own.trace_id) continue
            writes.updates.push({
                traceId: section.own.trace_id,
                spanId: section.own.span_id,
                annotation: {
                    data: {outputs},
                    references: section.own.references,
                    links: section.own.links,
                    meta: section.own.meta,
                },
            })
            continue
        }

        if (!traceId || !spanId) {
            throw new Error("A new annotation needs the trace and span id of the selected span")
        }
        writes.creates.push({
            data: {outputs},
            references: {evaluator: {id: section.workflowId, slug: section.slug}},
            links: {invocation: {trace_id: traceId, span_id: spanId}},
            origin: "human",
            kind: "adhoc",
            channel: "web",
            meta: {
                name: section.name,
                description: section.description,
                tags: Object.keys(outputs),
            },
        })
    }

    return writes
}
