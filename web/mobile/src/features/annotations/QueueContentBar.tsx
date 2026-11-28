import {annotationSessionController} from "@agenta/annotation"
import {traceRootSpanAtomFamily} from "@agenta/entities/trace"
import {useT} from "@agenta/i18n"
import queueScreensCatalog from "@agenta/i18n/catalogs/annotation.queueScreens"
import valueViewCatalog from "@agenta/i18n/catalogs/chat.valueView"
import type {TraceSpanNode} from "@agenta/observability"
import {ExecutionMetricsDisplay} from "@agenta/ui/components/presentational"
import {Button} from "@agenta/ui/ui"
import {CaretLeft, CaretRight, SidebarSimple, TreeStructure} from "@phosphor-icons/react"
import {useAtomValue, useSetAtom} from "jotai"

import {readTraceMetrics} from "@/features/observability/sessionDrawer/sessionTurns"

import {QueueMoreMenu} from "./QueueMoreMenu"
import {useScenarioTraceOpener} from "./useScenarioTraceOpener"

/** The duration, tokens and cost of a trace item, from its root span. */
const TraceMetrics = ({traceId}: {traceId: string}) => {
    const rootSpan = useAtomValue(traceRootSpanAtomFamily(traceId || null))
    if (!rootSpan) return null
    return (
        <ExecutionMetricsDisplay
            variant="plain"
            metrics={readTraceMetrics(rootSpan as TraceSpanNode)}
            className="min-w-0 truncate"
        />
    )
}

/**
 * The bar above the content: "Show items" while the list is folded, "Item N of M" with previous
 * and next, a trace item's metrics and "Open trace", and "More".
 */
export const QueueContentBar = ({
    scenarioId,
    onShowItems,
    submission,
}: {
    scenarioId: string
    /** Set while the item list is folded. */
    onShowItems?: () => void
    submission: {isCompleted: boolean; isSubmitting: boolean; hasPendingChanges: boolean}
}) => {
    const t = useT(queueScreensCatalog, valueViewCatalog)
    const progress = useAtomValue(annotationSessionController.selectors.progress())
    const hasNext = useAtomValue(annotationSessionController.selectors.hasNext())
    const hasPrev = useAtomValue(annotationSessionController.selectors.hasPrev())
    const navigateNext = useSetAtom(annotationSessionController.actions.navigateNext)
    const navigatePrev = useSetAtom(annotationSessionController.actions.navigatePrev)
    const openTrace = useScenarioTraceOpener(scenarioId)
    const {traceId} = useAtomValue(
        annotationSessionController.selectors.scenarioTraceRef(scenarioId),
    )

    return (
        <div className="flex min-h-12 shrink-0 items-center gap-2 px-4 py-2 sm:px-6">
            {onShowItems ? (
                <Button type="button" size="sm" variant="ghost" onClick={onShowItems}>
                    <SidebarSimple aria-hidden size={14} />
                    {t("annotation.queueScreens.showItems")}
                </Button>
            ) : null}
            <span className="shrink-0 text-label text-foreground">
                {t("annotation.queueScreens.itemPosition", {
                    position: progress.currentIndex + 1,
                    total: progress.total,
                })}
            </span>
            <Button
                type="button"
                size="icon-sm"
                variant="outline"
                disabled={!hasPrev}
                aria-label={t("annotation.queueScreens.previousItem")}
                title={t("annotation.queueScreens.previousItem")}
                onClick={() => navigatePrev()}
            >
                <CaretLeft aria-hidden size={13} />
            </Button>
            <Button
                type="button"
                size="icon-sm"
                variant="outline"
                disabled={!hasNext}
                aria-label={t("annotation.queueScreens.nextItem")}
                title={t("annotation.queueScreens.nextItem")}
                onClick={() => navigateNext()}
            >
                <CaretRight aria-hidden size={13} />
            </Button>
            <span className="hidden min-w-0 flex-1 pl-2 lg:flex">
                {openTrace ? <TraceMetrics traceId={traceId} /> : null}
            </span>
            <span className="flex-1 lg:hidden" />
            {openTrace ? (
                <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    aria-label={t("chat.valueView.openTrace")}
                    onClick={openTrace}
                >
                    <TreeStructure aria-hidden size={14} />
                    <span className="hidden sm:inline">{t("chat.valueView.openTrace")}</span>
                </Button>
            ) : null}
            <QueueMoreMenu scenarioId={scenarioId} submission={submission} />
        </div>
    )
}
