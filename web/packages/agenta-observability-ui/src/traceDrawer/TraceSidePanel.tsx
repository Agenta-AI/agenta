import {useMemo} from "react"

import type {AnnotationDto} from "@agenta/entities/annotation/dto"
import {evaluatorsListDataAtom} from "@agenta/entities/workflow"
import {useT} from "@agenta/i18n"
import drawerCatalog from "@agenta/i18n/catalogs/observabilityUi.traceDrawer"
import type {TraceSpanNode} from "@agenta/observability"
import type {TracesWithAnnotations} from "@agenta/observability/dto"
import {useTraceDrawer} from "@agenta/observability/traceDrawer"
import {cn, SkeletonBlock} from "@agenta/ui/ui"
import {useAtomValue} from "jotai"

import {annotationResults, annotationResultsHeader} from "./annotationResults"
import {getTraceDrawerReferences} from "./referenceSlots"
import SpanMetricsGrid from "./SpanMetricsGrid"
import TraceAnnotations from "./TraceAnnotations"
import TraceLinkedSpans from "./TraceLinkedSpans"
import TraceReferences from "./TraceReferences"

/**
 * The Annotations section: one evaluator result row per evaluator, through the host's
 * `AnnotationResultRow` slot, under a header with the evaluator count and "Passed X of Y". A
 * host with no row slot gets the annotation list. A span with no annotation has no section.
 */
export const SpanAnnotations = ({annotations}: {annotations: AnnotationDto[]}) => {
    const t = useT(drawerCatalog)
    const {AnnotationResultRow} = getTraceDrawerReferences()
    const evaluators = useAtomValue(evaluatorsListDataAtom)
    const results = useMemo(() => {
        const names = new Map<string, string>()
        for (const evaluator of evaluators) {
            if (evaluator?.slug && evaluator.name) names.set(evaluator.slug, evaluator.name)
        }
        return annotationResults(annotations, names)
    }, [annotations, evaluators])

    if (!results.length) return null
    const header = annotationResultsHeader(results)

    return (
        <section className="flex flex-col gap-1" data-testid="trace-annotations">
            <div className="flex items-baseline gap-2">
                <h3 className="m-0 text-label">
                    {t("observabilityUi.traceDrawer.tabAnnotations")}
                </h3>
                <span className="text-meta text-muted-foreground">
                    {t("observabilityUi.traceDrawer.evaluatorCount", {count: header.evaluators})}
                </span>
                {header.passed ? (
                    <span
                        className={cn(
                            "ml-auto text-meta font-medium",
                            header.passed.passed < header.passed.total
                                ? "text-destructive"
                                : "text-muted-foreground",
                        )}
                    >
                        {t("observabilityUi.traceDrawer.annotationsPassed", header.passed)}
                    </span>
                ) : null}
            </div>
            {AnnotationResultRow ? (
                <div className="flex flex-col">
                    {results.map((result) => (
                        <AnnotationResultRow
                            key={result.key}
                            evaluatorName={result.evaluatorName}
                            origin={result.origin}
                            metrics={result.metrics}
                            author={result.author}
                            summary={result.summary}
                        />
                    ))}
                </div>
            ) : (
                <TraceAnnotations annotations={annotations} />
            )}
        </section>
    )
}

/**
 * The side panel of the trace view: the span's metrics grid, then References, Linked spans and
 * Annotations. A section with nothing in it is not drawn.
 */
const TraceSidePanel = ({
    activeTrace,
    activeTraceId,
    isLoading = false,
}: {
    activeTrace?: TracesWithAnnotations
    activeTraceId?: string
    isLoading?: boolean
}) => {
    const t = useT(drawerCatalog)
    const {getTraceById} = useTraceDrawer()
    const derived = (activeTrace || getTraceById(activeTraceId)) as TraceSpanNode | undefined

    if (isLoading && !derived) {
        return (
            <div className="flex flex-col gap-2 p-4" aria-busy>
                {[0, 1, 2, 3].map((row) => (
                    <SkeletonBlock key={row} className="max-w-[160px]" />
                ))}
            </div>
        )
    }

    if (!derived) {
        return (
            <div className="p-4">
                <span className="text-body text-muted-foreground">
                    {t("observabilityUi.traceDrawer.selectSpanDetails")}
                </span>
            </div>
        )
    }

    return (
        <div className="flex flex-col gap-5 p-4" data-testid="trace-side-panel">
            <SpanMetricsGrid span={derived} />
            <TraceReferences span={derived} />
            <TraceLinkedSpans />
            <SpanAnnotations annotations={derived.annotations ?? []} />
        </div>
    )
}

export default TraceSidePanel
