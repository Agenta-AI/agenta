import {useMemo} from "react"

import type {TraceSpanNode} from "@agenta/entities/trace"
import {annotationEvaluatorSlugsAtom, useObservability} from "@agenta/observability"
import {useAtomValue} from "jotai"

/**
 * Which evaluator columns the traces table shows.
 *
 * This lived in web/oss, so `/m` hardcoded an empty list and silently had no evaluator columns
 * (and, once the CSV learned to export them, no evaluator headers either) — the exact drift the
 * shared table was meant to end. Both surfaces derive it here now.
 */

/**
 * Slugs actually present on the loaded rows. Spans carry their metrics under
 * `aggregatedEvaluatorMetrics`, and children are visited because a root trace's metrics can sit
 * on a descendant span.
 */
export const collectEvaluatorSlugsFromTraces = (traces: TraceSpanNode[]): string[] => {
    const slugs = new Set<string>()

    const visit = (node?: TraceSpanNode) => {
        if (!node) return

        const metrics = (
            node as TraceSpanNode & {aggregatedEvaluatorMetrics?: Record<string, unknown>}
        )?.aggregatedEvaluatorMetrics
        if (metrics && typeof metrics === "object") {
            Object.keys(metrics).forEach((slug) => {
                if (slug) slugs.add(slug)
            })
        }

        const children = (node as TraceSpanNode & {children?: TraceSpanNode[]})?.children
        if (Array.isArray(children)) children.forEach((child) => visit(child))
    }

    traces.forEach((trace) => visit(trace))
    return Array.from(slugs)
}

/**
 * Annotation order first (the project's evaluator order), then anything the rows carry that the
 * annotations did not mention, sorted so the column order is stable across renders.
 */
export const orderEvaluatorSlugs = (annotationSlugs: string[], traceSlugs: string[]): string[] => {
    if (!annotationSlugs.length && !traceSlugs.length) return []

    const present = new Set(traceSlugs)
    const ordered: string[] = []

    annotationSlugs.forEach((slug) => {
        if (present.has(slug)) {
            ordered.push(slug)
            present.delete(slug)
        }
    })

    return [...ordered, ...Array.from(present).sort()]
}

/** The evaluator slugs for the current traces. Both surfaces call this; neither derives it. */
export const useEvaluatorSlugs = (): string[] => {
    const {traces} = useObservability()
    const annotationSlugs = useAtomValue(annotationEvaluatorSlugsAtom)
    const traceSlugs = useMemo(
        () => collectEvaluatorSlugsFromTraces(traces as TraceSpanNode[]),
        [traces],
    )

    return useMemo(
        () => orderEvaluatorSlugs(annotationSlugs, traceSlugs),
        [annotationSlugs, traceSlugs],
    )
}

export default useEvaluatorSlugs
