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
} from "@agenta/observability/traceDrawer"
import {Button, SimpleTooltip, SkeletonBlock} from "@agenta/ui/ui"
import {ArrowsIn, ArrowsOut, X} from "@phosphor-icons/react"
import {useAtomValue, useSetAtom} from "jotai"
import dynamic from "next/dynamic"

const TraceContent = dynamic(() => import("./TraceContent"))
const TraceHeader = dynamic(() => import("./TraceHeader"))
const TraceTree = dynamic(() => import("./TraceTree"))

export type TraceDrawerLayout = "split" | "stacked"

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
            <div className="flex items-center gap-3 px-4 py-3 border-0 border-b border-solid border-border-muted">
                {/* The panel is already as wide as the screen when stacked; widening does nothing. */}
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
            {/* antd `Spin` wrapped the body and dimmed it; the tree/content render their own
                skeletons, so a loading pass just shows a block above them. */}
            <div className="flex-1 min-h-0">
                {isLoading ? <SkeletonBlock className="m-3 max-w-[160px]" /> : null}
                <div className="h-full">
                    {/* antd Splitter: a 320px tree column beside the content. Stacked, the tree
                        takes the top of the panel and the content the rest, both full width. */}
                    <div className={stacked ? "flex h-full flex-col" : "flex h-full"}>
                        <div
                            className={
                                stacked
                                    ? "h-[35%] w-full shrink-0 border-0 border-b border-solid border-border-muted"
                                    : "w-[320px] min-w-[320px] shrink-0 border-0 border-r border-solid border-border-muted"
                            }
                        >
                            <TraceTree
                                activeTraceId={activeId}
                                selected={activeId}
                                setSelected={setSelected}
                            />
                        </div>
                        <div
                            className={stacked ? "flex-1 min-h-0 min-w-0" : "flex-1 min-w-[400px]"}
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
        </div>
    )
}

export default TraceDrawerContent
