import {useMemo} from "react"

import {EvaluatorResultRow, ValueViewProvider} from "@agenta/chat/value-view"
import {summarizeEvaluatorResult} from "@agenta/entities/evaluationRun"
import {useT} from "@agenta/i18n"
import spanCatalog from "@agenta/i18n/catalogs/observabilityUi.traceSpan"
import type {AnnotationResultRowProps} from "@agenta/observability-ui/traceDrawer"

import {chatProseClassName, markdownIcons} from "@/features/chat/AssistantMarkdown"

const ORIGIN_KEYS = {
    auto: "observabilityUi.traceSpan.evaluatorAuto",
    human: "observabilityUi.traceSpan.evaluatorHuman",
    custom: "observabilityUi.traceSpan.evaluatorCustom",
} as const

/**
 * The trace drawer's `AnnotationResultRow` slot on `/m`: one annotation of the span
 * as an evaluator result row, the origin after its name. With no run catalog in the trace view,
 * each metric's kind comes from its value.
 */
export const TraceAnnotationResultRow = ({
    evaluatorName,
    origin,
    metrics,
}: AnnotationResultRowProps) => {
    const t = useT(spanCatalog)
    const summary = useMemo(
        () =>
            summarizeEvaluatorResult(
                metrics.map((metric) => ({...metric, kind: null})),
                "done",
            ),
        [metrics],
    )
    const originLabel =
        origin && Object.hasOwn(ORIGIN_KEYS, origin)
            ? t(ORIGIN_KEYS[origin as keyof typeof ORIGIN_KEYS])
            : origin
    return (
        <ValueViewProvider markdownClassName={chatProseClassName} markdownIcons={markdownIcons}>
            <EvaluatorResultRow
                // The row takes the name as text, so the origin follows it there.
                name={originLabel ? `${evaluatorName} · ${originLabel}` : evaluatorName}
                summary={summary}
            />
        </ValueViewProvider>
    )
}

export default TraceAnnotationResultRow
