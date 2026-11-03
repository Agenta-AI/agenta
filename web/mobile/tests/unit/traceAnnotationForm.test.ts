/**
 * The rules of the trace annotate form: which annotations the form edits, and which create and
 * update requests a save sends. Pure functions over the package schema helpers.
 */
import type {AnnotationDto} from "@agenta/entities/annotation/dto"
import type {Workflow} from "@agenta/entities/workflow"
import {describe, expect, it} from "vitest"

import {
    buildTraceAnnotationSections,
    buildTraceAnnotationWrites,
    pickEditableAnnotations,
} from "@/features/observability/annotate/traceAnnotationForm"

const ALEX = "user-alex"
const SAM = "user-sam"

const annotation = (overrides: Partial<AnnotationDto> & {created_at?: string}): AnnotationDto =>
    ({
        trace_id: "ann-trace-1",
        span_id: "ann-span-1",
        data: {outputs: {}},
        references: {evaluator: {id: "wf-tone", slug: "tone"}},
        links: {invocation: {trace_id: "trace-1", span_id: "span-1"}},
        channel: "web",
        kind: "adhoc",
        origin: "human",
        meta: {name: "Tone", description: "How friendly the reply is", tags: ["friendly"]},
        createdById: ALEX,
        created_at: "2026-11-01T10:00:00Z",
        createdAt: "01 Nov 2026",
        ...overrides,
    }) as AnnotationDto

const evaluator = (
    slug: string,
    properties: Record<string, unknown>,
    required: string[] = [],
): Workflow =>
    ({
        id: `rev-${slug}`,
        workflow_id: `wf-${slug}`,
        slug,
        name: slug === "tone" ? "Tone" : "Score",
        description: `${slug} evaluator`,
        data: {schemas: {outputs: {type: "object", properties, required}}},
    }) as unknown as Workflow

const TONE = evaluator("tone", {friendly: {type: "boolean"}})
const SCORE = evaluator(
    "score",
    {
        rating: {type: "integer", minimum: 1, maximum: 5},
        comment: {type: "string"},
        label: {type: ["string", "null"], enum: ["good", "bad", null]},
    },
    ["rating"],
)

describe("pickEditableAnnotations", () => {
    it("Only the newest own web human adhoc annotation per evaluator is editable", () => {
        const older = annotation({
            trace_id: "ann-old",
            created_at: "2026-11-01T09:00:00Z",
            data: {outputs: {metrics: {friendly: false}}},
        })
        const newer = annotation({
            trace_id: "ann-new",
            created_at: "2026-11-01T11:00:00Z",
            data: {outputs: {metrics: {friendly: true}}},
        })
        const fromSdk = annotation({
            trace_id: "ann-sdk",
            channel: "sdk",
            created_at: "2026-11-01T12:00:00Z",
        })
        const auto = annotation({
            trace_id: "ann-auto",
            origin: "auto",
            channel: "sdk",
            references: {evaluator: {id: "wf-judge", slug: "judge"}},
        })

        const picked = pickEditableAnnotations({
            annotations: [older, newer, fromSdk, auto],
            userId: ALEX,
        })

        expect(picked.own.map((item) => item.trace_id)).toEqual(["ann-new"])
        expect(picked.otherSlugs).toEqual([])
    })

    it("Same day annotations are ordered by their full time, not the shown day", () => {
        const morning = annotation({trace_id: "ann-morning", created_at: "2026-11-01T08:00:00Z"})
        const evening = annotation({trace_id: "ann-evening", created_at: "2026-11-01T20:00:00Z"})

        const picked = pickEditableAnnotations({annotations: [evening, morning], userId: ALEX})

        expect(picked.own.map((item) => item.trace_id)).toEqual(["ann-evening"])
    })

    it("Another user's human annotation adds its evaluator as an empty section", () => {
        const fromSam = annotation({trace_id: "ann-sam", createdById: SAM})

        const picked = pickEditableAnnotations({annotations: [fromSam], userId: ALEX})

        expect(picked.own).toEqual([])
        expect(picked.otherSlugs).toEqual(["tone"])
    })

    it("A newer annotation by another user does not hide the user's own one", () => {
        const own = annotation({trace_id: "ann-alex", created_at: "2026-11-01T08:00:00Z"})
        const fromSam = annotation({
            trace_id: "ann-sam",
            createdById: SAM,
            created_at: "2026-11-01T09:00:00Z",
        })

        const picked = pickEditableAnnotations({annotations: [own, fromSam], userId: ALEX})

        expect(picked.own.map((item) => item.trace_id)).toEqual(["ann-alex"])
        expect(picked.otherSlugs).toEqual([])
    })

    it("An own annotation without its trace id is not editable", () => {
        const broken = annotation({trace_id: undefined})

        expect(pickEditableAnnotations({annotations: [broken], userId: ALEX}).own).toEqual([])
    })

    it("Automatic annotations by other sources add no section", () => {
        const auto = annotation({createdById: SAM, origin: "auto", channel: "sdk"})

        expect(pickEditableAnnotations({annotations: [auto], userId: ALEX})).toEqual({
            own: [],
            otherSlugs: [],
        })
    })
})

describe("buildTraceAnnotationWrites", () => {
    const sectionsFor = (own: AnnotationDto[] = []) =>
        buildTraceAnnotationSections({
            slugs: ["tone", "score"],
            evaluators: new Map([
                ["tone", {workflowId: "wf-tone", revision: TONE}],
                ["score", {workflowId: "wf-score", revision: SCORE}],
            ]),
            own,
        })

    it("Sections follow the given order and fill own values", () => {
        const sections = sectionsFor([annotation({data: {outputs: {metrics: {friendly: true}}}})])

        expect(sections.map((section) => section.slug)).toEqual(["tone", "score"])
        expect(sections[0].fields.friendly.value).toBe(true)
        expect(sections[0].own?.trace_id).toBe("ann-trace-1")
        expect(sections[1].own).toBeNull()
        expect(sections[1].required).toEqual(["rating"])
    })

    it("A changed own annotation becomes one update that keeps its references and links", () => {
        const own = annotation({
            data: {outputs: {metrics: {friendly: true}}},
            references: {
                evaluator: {id: "wf-tone", slug: "tone"},
                evaluator_revision: {id: "rev-tone", slug: "tone-v2", version: 2},
            },
        })

        const writes = buildTraceAnnotationWrites({
            sections: sectionsFor([own]),
            values: {tone: {friendly: false}},
            traceId: "trace-1",
            spanId: "span-1",
        })

        expect(writes.creates).toEqual([])
        expect(writes.missingRequired).toEqual({})
        expect(writes.updates).toEqual([
            {
                traceId: "ann-trace-1",
                spanId: "ann-span-1",
                annotation: {
                    data: {outputs: {friendly: false}},
                    references: own.references,
                    links: own.links,
                    meta: own.meta,
                },
            },
        ])
    })

    it("A new evaluator value becomes one create linked under invocation", () => {
        const writes = buildTraceAnnotationWrites({
            sections: sectionsFor(),
            values: {tone: {friendly: true}},
            traceId: "trace-1",
            spanId: "span-1",
        })

        expect(writes.updates).toEqual([])
        expect(writes.creates).toEqual([
            {
                data: {outputs: {friendly: true}},
                references: {evaluator: {id: "wf-tone", slug: "tone"}},
                links: {invocation: {trace_id: "trace-1", span_id: "span-1"}},
                origin: "human",
                kind: "adhoc",
                channel: "web",
                meta: {name: "Tone", description: "tone evaluator", tags: ["friendly"]},
            },
        ])
    })

    it("Optional empty metrics are dropped and none of the above is sent as null", () => {
        const writes = buildTraceAnnotationWrites({
            sections: sectionsFor(),
            values: {score: {rating: 4, comment: "", label: "null"}},
            traceId: "trace-1",
            spanId: "span-1",
        })

        expect(writes.creates).toHaveLength(1)
        expect(writes.creates[0].data).toEqual({outputs: {rating: 4, label: null}})
        expect(writes.creates[0].meta?.tags).toEqual(["rating", "label"])
    })

    it("A required empty metric blocks that evaluator and is reported", () => {
        const writes = buildTraceAnnotationWrites({
            sections: sectionsFor(),
            values: {score: {comment: "Too short"}, tone: {friendly: true}},
            traceId: "trace-1",
            spanId: "span-1",
        })

        expect(writes.missingRequired).toEqual({score: ["rating"]})
        expect(writes.creates.map((item) => item.references?.evaluator.slug)).toEqual(["tone"])
    })

    it("An unchanged form produces no writes", () => {
        const own = annotation({data: {outputs: {metrics: {friendly: true}}}})

        const writes = buildTraceAnnotationWrites({
            sections: sectionsFor([own]),
            values: {tone: {friendly: true}, score: {comment: ""}},
            traceId: "trace-1",
            spanId: "span-1",
        })

        expect(writes).toEqual({creates: [], updates: [], missingRequired: {}})
    })

    it("An update keeps saved outputs the form does not show", () => {
        const own = annotation({
            data: {outputs: {metrics: {friendly: true}, notes: {comment: "Kind words"}}},
        })

        const writes = buildTraceAnnotationWrites({
            sections: sectionsFor([own]),
            values: {tone: {friendly: false}},
            traceId: "trace-1",
            spanId: "span-1",
        })

        expect(writes.updates[0].annotation.data).toEqual({
            outputs: {friendly: false, comment: "Kind words"},
        })
    })

    it("A saved none of the above answer is kept when another metric changes", () => {
        const own = annotation({
            references: {evaluator: {id: "wf-score", slug: "score"}},
            data: {outputs: {rating: 3, label: null}},
        })

        const writes = buildTraceAnnotationWrites({
            sections: sectionsFor([own]),
            values: {score: {rating: 4}},
            traceId: "trace-1",
            spanId: "span-1",
        })

        expect(writes.updates[0].annotation.data).toEqual({outputs: {rating: 4, label: null}})
    })

    it("A cleared own metric is removed from the saved outputs", () => {
        const own = annotation({data: {outputs: {metrics: {friendly: true}}}})

        const writes = buildTraceAnnotationWrites({
            sections: sectionsFor([own]),
            values: {tone: {friendly: null}},
            traceId: "trace-1",
            spanId: "span-1",
        })

        expect(writes.updates[0].annotation.data).toEqual({outputs: {}})
    })

    it("The section name comes from the workflow, not the revision", () => {
        const sections = buildTraceAnnotationSections({
            slugs: ["tone"],
            evaluators: new Map([
                [
                    "tone",
                    {
                        workflowId: "wf-tone",
                        name: "Reply tone",
                        description: "Tone of the reply",
                        revision: {...TONE, name: "default"} as Workflow,
                    },
                ],
            ]),
            own: [],
        })

        expect(sections[0].name).toBe("Reply tone")
        expect(sections[0].description).toBe("Tone of the reply")
    })
})
