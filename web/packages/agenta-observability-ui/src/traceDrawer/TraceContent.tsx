import {useState} from "react"

import {useT} from "@agenta/i18n"
import drawerCatalog from "@agenta/i18n/catalogs/observabilityUi.traceDrawer"
import {traceSidePanelOpenAtom} from "@agenta/observability/traceDrawer"
import {getRawTraceSpanData} from "@agenta/observability/traceDrawer"
import {TraceContentProps} from "@agenta/observability/traceDrawer"
import {SkeletonBlock} from "@agenta/ui/ui"
import {useAtomValue} from "jotai"

import AccordionTreePanel from "./AccordionTreePanel"
import OverviewTabItem from "./OverviewTabItem"
import type {TraceDrawerLayout} from "./TraceDrawerContent"
import TraceSidePanel from "./TraceSidePanel"
import TraceTypeHeader from "./TraceTypeHeader"
import type {SpanBodyMode} from "./traceTypeHeaderTypes"

const loadingContent = (
    <div className="flex flex-col gap-2 px-4 py-6">
        {[0, 1, 2, 3, 4, 5].map((row) => (
            <SkeletonBlock key={row} className="max-w-[160px]" />
        ))}
    </div>
)

/**
 * The span column and the side panel of the trace view. The span column is the span header
 * with the Formatted / Raw switch over the span body: Formatted draws each section by the shape
 * of its value, Raw shows the span as JSON or YAML with search. Side by side, each column
 * scrolls on its own; stacked, the side panel goes under the span body.
 */
const TraceContent = ({
    activeTrace,
    traceResponse,
    error,
    isLoading,
    activeId,
    layout = "split",
}: TraceContentProps & {layout?: TraceDrawerLayout}) => {
    const t = useT(drawerCatalog)
    const stacked = layout === "stacked"
    const sidePanelOpen = useAtomValue(traceSidePanelOpenAtom)
    // Kept while the user moves between spans.
    const [mode, setMode] = useState<SpanBodyMode>("formatted")

    const body = (() => {
        if (isLoading && !activeTrace) return loadingContent

        // No span: the trace is not found, or the generation failed and only the error is left.
        if (!activeTrace) {
            const response = (traceResponse as {response?: unknown} | undefined)?.response
            if (!error && !response) {
                return (
                    <div className="flex flex-col items-center gap-1 px-4 py-12 text-center">
                        <span className="text-label">
                            {t("observabilityUi.traceDrawer.traceNotFound")}
                        </span>
                        <span className="text-meta text-muted-foreground">
                            {t("observabilityUi.traceDrawer.traceNotFoundHint")}
                        </span>
                    </div>
                )
            }
            return (
                <div className="p-4">
                    <AccordionTreePanel
                        label={
                            error
                                ? t("observabilityUi.traceDrawer.rawDataError")
                                : t("observabilityUi.traceDrawer.tabRawData")
                        }
                        value={(response ?? (error ? {error} : {})) as never}
                        enableFormatSwitcher
                        fullEditorHeight
                        enableSearch
                    />
                </div>
            )
        }

        if (mode === "raw") {
            return (
                <div className="p-4">
                    <AccordionTreePanel
                        label={t("observabilityUi.traceDrawer.tabRawData")}
                        value={getRawTraceSpanData(activeTrace) as never}
                        enableFormatSwitcher
                        enableSearch
                        rawOnly
                    />
                </div>
            )
        }
        return (
            <div className="p-4">
                <OverviewTabItem activeTrace={activeTrace} mode="formatted" />
            </div>
        )
    })()

    return (
        <div className={stacked ? "flex w-full flex-col" : "flex h-full min-h-0 w-full"}>
            <div
                className={
                    stacked ? "flex min-w-0 flex-col" : "flex min-h-0 min-w-0 flex-1 flex-col"
                }
            >
                <TraceTypeHeader
                    activeTrace={activeTrace}
                    error={error}
                    mode={mode}
                    onModeChange={setMode}
                />
                <div
                    className={stacked ? "min-w-0" : "min-h-0 flex-1 overflow-y-auto"}
                    data-testid="trace-span-body"
                >
                    {body}
                </div>
            </div>
            {sidePanelOpen && (activeTrace || isLoading) ? (
                <aside
                    className={
                        stacked
                            ? "w-full border-0 border-t border-solid border-border-muted"
                            : "w-[340px] min-w-[340px] shrink-0 overflow-y-auto border-0 border-l border-solid border-border-muted"
                    }
                >
                    <TraceSidePanel
                        activeTrace={activeTrace as never}
                        activeTraceId={activeId}
                        isLoading={isLoading}
                    />
                </aside>
            ) : null}
        </div>
    )
}

export default TraceContent
