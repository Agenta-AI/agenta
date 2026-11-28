import {useCallback, useEffect, type SetStateAction} from "react"

import {useT} from "@agenta/i18n"
import commonCatalog from "@agenta/i18n/catalogs/common"
import drawerCatalog from "@agenta/i18n/catalogs/observabilityUi.traceDrawer"
import {useObservability} from "@agenta/observability"
import {useTraceDrawer} from "@agenta/observability/traceDrawer"
import {traceDrawerSetQueryParam} from "@agenta/observability/traceDrawer"
import {
    setTraceDrawerActiveSpanAtom,
    setTraceDrawerTraceAtom,
    traceDrawerActiveSpanIdAtom,
    traceSidePanelOpenAtom,
} from "@agenta/observability/traceDrawer"
import {Button, SimpleTooltip, SkeletonBlock} from "@agenta/ui/ui"
import {ArrowsIn, ArrowsOut, SidebarSimple, X} from "@phosphor-icons/react"
import {useAtom, useAtomValue, useSetAtom} from "jotai"
import dynamic from "next/dynamic"

const TraceContent = dynamic(() => import("./TraceContent"))
const TraceHeader = dynamic(() => import("./TraceHeader"))
const TraceTopBarActions = dynamic(() => import("./TraceTopBarActions"))
const TraceTree = dynamic(() => import("./TraceTree"))

export type TraceDrawerLayout = "split" | "stacked"

/** The tree on top, full width: the stacked layout, and a split drawer under 760px. */
const STACKED_TREE = "h-[35%] w-full shrink-0 border-0 border-b border-solid border-border-muted"
/** The tree beside the span in a split drawer of 760px or more. */
const SPLIT_TREE =
    "@min-[760px]/trace-drawer:h-auto @min-[760px]/trace-drawer:w-[360px] @min-[760px]/trace-drawer:min-w-[360px] @min-[760px]/trace-drawer:border-b-0 @min-[760px]/trace-drawer:border-r"
const SPLIT_ROW = "flex h-full flex-col @min-[760px]/trace-drawer:flex-row"

interface TraceDrawerContentProps {
    onClose: () => void
    onToggleWidth: () => void
    isExpanded: boolean
    layout?: TraceDrawerLayout
}

const TraceDrawerContent = ({
    onClose,
    onToggleWidth,
    isExpanded,
    layout = "split",
}: TraceDrawerContentProps) => {
    const stacked = layout === "stacked"
    const {traces, activeSpanId, getTraceById, traceResponse, error, isLoading, traceId} =
        useTraceDrawer()
    const {
        traceTabs,
        filters,
        sort,
        limit,
        setSelectedTraceId: setGlobalSelectedTraceId,
        setSelectedNode: setGlobalSelectedNode,
    } = useObservability()
    const t = useT(drawerCatalog, commonCatalog)
    const [sidePanelOpen, setSidePanelOpen] = useAtom(traceSidePanelOpenAtom)
    const sidePanelLabel = sidePanelOpen
        ? t("observabilityUi.traceDrawer.hideDetailsPanel")
        : t("observabilityUi.traceDrawer.showDetailsPanel")
    const rawActiveSpanId = useAtomValue(traceDrawerActiveSpanIdAtom)
    const setActiveSpan = useSetAtom(setTraceDrawerActiveSpanAtom)
    const setTraceDrawerTrace = useSetAtom(setTraceDrawerTraceAtom)
    const setTraceQueryParam = useCallback(
        (value: string | null | undefined) => traceDrawerSetQueryParam("trace", value),
        [],
    )
    const setSpanQueryParam = useCallback(
        (value: string | null | undefined) => traceDrawerSetQueryParam("span", value),
        [],
    )

    const activeId = activeSpanId || ""

    // Write the stored id only when it is not a loaded span.
    useEffect(() => {
        if (!traces.length || !activeId) return
        if (rawActiveSpanId === activeId) return
        setActiveSpan(activeId)
    }, [traces.length, activeId, rawActiveSpanId, setActiveSpan])

    useEffect(() => {
        setSpanQueryParam(activeId || null)
    }, [activeId, setSpanQueryParam])

    const setSelected = useCallback(
        (value: SetStateAction<string>) => {
            const next = typeof value === "function" ? value(activeId) : value
            setActiveSpan(next || null)
        },
        [activeId, setActiveSpan],
    )

    const activeTrace = getTraceById(activeId)

    return (
        <div className="h-full w-full flex flex-col" data-tour="trace-drawer">
            {/* The top bar: trace navigation on the left; the span actions, width, side panel
                and close on the right. */}
            <div className="flex flex-wrap items-center gap-2 px-4 py-2 border-0 border-b border-solid border-border-muted">
                <div className="flex-1 min-w-0">
                    <TraceHeader
                        activeTrace={activeTrace as never}
                        activeTraceId={activeId}
                        traceId={traceId}
                        traces={traces as never}
                        traceTabs={traceTabs}
                        filters={filters}
                        sort={sort}
                        limit={limit}
                        setSelectedTraceId={setGlobalSelectedTraceId}
                        setSelectedNode={setGlobalSelectedNode}
                        setTraceParam={setTraceQueryParam}
                        setSpanParam={setSpanQueryParam}
                        setTraceDrawerTrace={setTraceDrawerTrace}
                        activeTraceIndex={0}
                        setSelected={setSelected}
                    />
                </div>
                <TraceTopBarActions
                    activeTrace={activeTrace as never}
                    traces={traces as never}
                    setSelectedTraceId={setGlobalSelectedTraceId}
                />
                <div className="flex shrink-0 items-center">
                    {/* The panel is already as wide as the screen when stacked; widening does
                        nothing. */}
                    {stacked ? null : (
                        <SimpleTooltip
                            title={isExpanded ? t("common.collapse") : t("common.expand")}
                        >
                            <Button
                                onClick={onToggleWidth}
                                variant="ghost"
                                size="icon"
                                aria-label={isExpanded ? t("common.collapse") : t("common.expand")}
                            >
                                {isExpanded ? <ArrowsIn size={14} /> : <ArrowsOut size={14} />}
                            </Button>
                        </SimpleTooltip>
                    )}
                    <SimpleTooltip title={sidePanelLabel}>
                        <Button
                            variant="ghost"
                            size="icon"
                            className={sidePanelOpen ? "bg-selected" : undefined}
                            aria-label={sidePanelLabel}
                            aria-pressed={sidePanelOpen}
                            onClick={() => setSidePanelOpen((prev) => !prev)}
                        >
                            <SidebarSimple size={14} />
                        </Button>
                    </SimpleTooltip>
                    {/* Close sits last, at the right edge, where the shared SheetHeader puts it. */}
                    <SimpleTooltip title={t("observabilityUi.traceDrawer.close")}>
                        <Button
                            onClick={onClose}
                            variant="ghost"
                            size="icon"
                            aria-label={t("observabilityUi.traceDrawer.close")}
                            data-tour="trace-drawer-close"
                        >
                            <X size={14} />
                        </Button>
                    </SimpleTooltip>
                </div>
            </div>
            {/* The split layout reads the drawer's own width (it is narrower than the screen): the
                tree sits beside the span only when both fit, 360px and 400px. */}
            <div className="@container/trace-drawer flex-1 min-h-0">
                {isLoading ? <SkeletonBlock className="m-3 max-w-[160px]" /> : null}
                {/* Three columns side by side, each scrolling on its own: the tree (360px), the
                    span, the side panel. Stacked, the tree takes the top of the panel and the
                    span and side panel the rest, all full width. */}
                <div className={stacked ? "flex h-full flex-col" : SPLIT_ROW}>
                    <div className={stacked ? STACKED_TREE : `${STACKED_TREE} ${SPLIT_TREE}`}>
                        <TraceTree
                            activeTraceId={activeId}
                            selected={activeId}
                            setSelected={setSelected}
                        />
                    </div>
                    <div
                        className={
                            stacked
                                ? "flex-1 min-h-0 min-w-0 overflow-y-auto"
                                : "flex-1 min-h-0 min-w-0 overflow-y-auto @min-[760px]/trace-drawer:overflow-visible"
                        }
                    >
                        <TraceContent
                            activeTrace={activeTrace as never}
                            traceResponse={traceResponse}
                            error={error as never}
                            isLoading={isLoading}
                            setSelectedTraceId={setGlobalSelectedTraceId}
                            traces={traces as never}
                            activeId={activeId}
                            layout={layout}
                        />
                    </div>
                </div>
            </div>
        </div>
    )
}

export default TraceDrawerContent
