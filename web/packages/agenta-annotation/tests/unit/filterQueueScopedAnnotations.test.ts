import type {Annotation} from "@agenta/entities/annotation"
import {describe, expect, it} from "vitest"

import {filterQueueScopedAnnotations, getQueueAnnotationTag} from "../../src/state/testsetSync"

// Regression for the "fresh queue shows old annotations" + "every row exported
// as annotated" bugs: annotations are stored as traces keyed by testcase id, so
// a query by testcase returns annotations from EVERY queue that touched it.
// Display and export must scope to the active queue's tag.
function annotation(queueIds: string[]): Annotation {
    const tags = queueIds.map(getQueueAnnotationTag)
    return {
        trace_id: `t-${queueIds.join("-") || "none"}`,
        span_id: "s-1",
        data: {outputs: {score: 1}},
        meta: {tags},
    } as unknown as Annotation
}

describe("filterQueueScopedAnnotations", () => {
    const QUEUE = "queue-current"
    const OTHER = "queue-old"

    it("keeps only annotations tagged with the active queue", () => {
        const current = annotation([QUEUE])
        const result = filterQueueScopedAnnotations(
            [current, annotation([OTHER]), annotation([])],
            QUEUE,
        )
        expect(result).toEqual([current])
    })

    it("returns empty for a fresh queue with only stale annotations", () => {
        const result = filterQueueScopedAnnotations([annotation([OTHER]), annotation([])], QUEUE)
        expect(result).toEqual([])
    })

    it("keeps an annotation tagged with multiple queues including the active one", () => {
        const multi = annotation([OTHER, QUEUE])
        expect(filterQueueScopedAnnotations([multi], QUEUE)).toEqual([multi])
    })

    it("is a no-op when no queue id is provided", () => {
        const all = [annotation([OTHER]), annotation([])]
        expect(filterQueueScopedAnnotations(all, "")).toEqual(all)
    })
})
