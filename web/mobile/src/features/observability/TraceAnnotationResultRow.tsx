import {EvaluatorResultRow, ValueViewProvider} from "@agenta/chat/value-view"
import {isHumanOrigin} from "@agenta/entities/evaluationRun"
import {UserAuthorLabel} from "@agenta/entities/shared"
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
 * The trace drawer's `AnnotationResultRow` slot on `/m`: one annotation of the span as an
 * evaluator result row, with its origin as the badge and its author as the byline. A human
 * annotation reads True or False. The summary comes from the drawer, so the row and the
 * header's "Passed X of Y" read the same one.
 */
export const TraceAnnotationResultRow = ({
    evaluatorName,
    origin,
    author,
    summary,
}: AnnotationResultRowProps) => {
    const t = useT(spanCatalog)
    const originWord =
        origin && Object.hasOwn(ORIGIN_KEYS, origin)
            ? t(ORIGIN_KEYS[origin as keyof typeof ORIGIN_KEYS])
            : origin
    return (
        <ValueViewProvider markdownClassName={chatProseClassName} markdownIcons={markdownIcons}>
            <EvaluatorResultRow
                name={evaluatorName}
                summary={summary}
                badge={
                    originWord ? (
                        <span className="shrink-0 text-meta text-muted-foreground">
                            {originWord}
                        </span>
                    ) : undefined
                }
                byline={
                    author.userId ? (
                        <UserAuthorLabel userId={author.userId} at={author.at} />
                    ) : undefined
                }
                binaryWords={isHumanOrigin(origin) ? "trueFalse" : "passFail"}
            />
        </ValueViewProvider>
    )
}

export default TraceAnnotationResultRow
