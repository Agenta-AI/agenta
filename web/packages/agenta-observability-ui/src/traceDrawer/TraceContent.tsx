import {useEffect, useMemo, useRef, useState, type ReactNode} from "react"

import {traceSidePanelOpenAtom} from "@agenta/observability/traceDrawer"
import {getRawTraceSpanData} from "@agenta/observability/traceDrawer"
import {TraceContentProps} from "@agenta/observability/traceDrawer"
import {Tabs, TabsContent, TabsList, TabsTrigger} from "@agenta/ui/ui"
import clsx from "clsx"
import {useAtom} from "jotai"

import {SkeletonBlock} from "../primitives/SkeletonBlock"

import AccordionTreePanel from "./AccordionTreePanel"
import AnnotationTabItem from "./AnnotationTabItem"
import LinkedSpansTabItem from "./LinkedSpansTabItem"
import OverviewTabItem from "./OverviewTabItem"
import {getTraceDrawerReferences} from "./referenceSlots"
import TraceSidePanel from "./TraceSidePanel"
import TraceTypeHeader from "./TraceTypeHeader"

const loadingContent = (
    <div className="px-4 py-6">
        <div className="flex flex-col gap-2">
            {[0, 1, 2, 3, 4, 5].map((row) => (
                <SkeletonBlock key={row} />
            ))}
        </div>
    </div>
)

const TraceContent = ({
    activeTrace: active,
    traceResponse,
    error,
    traces,
    isLoading,
    setSelectedTraceId,
    activeId,
}: TraceContentProps) => {
    const {TraceSpanDrillInView: TraceSpanDrillInViewSlot} = getTraceDrawerReferences()
    const [isAnnotationsSectionOpen, setIsAnnotationsSectionOpen] = useAtom(traceSidePanelOpenAtom)
    const activeTrace = active
    const spanEntityId = activeTrace?.span_id || activeTrace?.invocationIds?.span_id || activeId
    const [tab, setTab] = useState("overview")
    const tabsWrapperRef = useRef<HTMLDivElement>(null)
    const [tabNavHeight, setTabNavHeight] = useState(0)

    // Measure the actual rendered tab nav bar height so sticky JSON headers
    // can be offset correctly below it (avoids hardcoded magic numbers).
    useEffect(() => {
        const el = tabsWrapperRef.current
        if (!el) return
        const nav = el.querySelector<HTMLElement>(".ant-tabs-nav")
        if (!nav) return
        const observer = new ResizeObserver(() => {
            setTabNavHeight(nav.getBoundingClientRect().height)
        })
        observer.observe(nav)
        // Capture initial height immediately
        setTabNavHeight(nav.getBoundingClientRect().height)
        return () => observer.disconnect()
    }, [])

    const items: {key?: string; label?: ReactNode; children?: ReactNode}[] = useMemo(() => {
        if (isLoading && !activeTrace) {
            return [
                {
                    key: "loading",
                    label: "Overview",
                    children: loadingContent,
                },
            ]
        }

        // When activeTrace is missing (e.g., failed generation), show just Raw Data/Error
        if (!activeTrace) {
            const errorPayload = error
            const rawPayload =
                (traceResponse as {response?: unknown} | undefined)?.response ??
                (errorPayload ? {error: errorPayload} : {})
            return [
                {
                    key: "raw_data",
                    label: "Raw Data",
                    children: (
                        <AccordionTreePanel
                            label={errorPayload ? "Error" : "Raw Data"}
                            value={rawPayload as never}
                            enableFormatSwitcher
                            fullEditorHeight
                            enableSearch
                        />
                    ),
                },
            ]
        }

        const rawActiveTrace = getRawTraceSpanData(activeTrace)

        return [
            {
                key: "overview",
                label: "Overview",
                children: (
                    <OverviewTabItem
                        activeTrace={activeTrace}
                        prettyJsonStickyOffset={tabNavHeight}
                    />
                ),
            },
            {
                key: "raw_data",
                label: "Raw Data",
                children: (
                    <>
                        {spanEntityId ? (
                            <TraceSpanDrillInViewSlot
                                spanId={spanEntityId}
                                spanDataOverride={rawActiveTrace}
                                title="Raw Data"
                                editable={false}
                                rootScope="span"
                                allowSpanCollapse={false}
                                prettyJsonStickyOffset={tabNavHeight}
                            />
                        ) : (
                            <AccordionTreePanel
                                label={"Raw Data"}
                                value={rawActiveTrace}
                                enableFormatSwitcher
                                fullEditorHeight
                                enableSearch
                            />
                        )}
                    </>
                ),
            },
            {
                key: "linked-span",
                label: "Linked Spans",
                children: <LinkedSpansTabItem isActive={tab === "linked-span"} />,
            },
            {
                key: "annotations",
                label: "Annotations",
                children: <AnnotationTabItem annotations={activeTrace?.annotations || []} />,
            },
        ]
    }, [activeTrace, isLoading, traceResponse, error, tab, spanEntityId, tabNavHeight])

    // Ensure active tab exists in items; if not, switch to first tab
    const itemKeys = useMemo(
        () => (items || []).map((it: {key?: string}) => String(it?.key)),
        [items],
    )
    useEffect(() => {
        if (!itemKeys.includes(tab) && itemKeys.length > 0) {
            setTab(itemKeys[0])
        }
    }, [itemKeys.join("|"), tab])

    return (
        <div
            className={clsx(
                "flex w-full h-full flex-1",
                "[&_.ant-tag]:m-0 [&_.ant-tag]:flex [&_.ant-tag]:items-center [&_.ant-tag]:gap-2",
            )}
        >
            <div className="flex-1 flex flex-col overflow-auto">
                <TraceTypeHeader
                    activeTrace={activeTrace}
                    error={error}
                    setSelectedTraceId={setSelectedTraceId}
                    setIsAnnotationsSectionOpen={setIsAnnotationsSectionOpen}
                    isAnnotationsSectionOpen={isAnnotationsSectionOpen}
                    traces={traces}
                />

                {/* antd Splitter gave a draggable 400/280 split; the side panel is a fixed
                    280px column here — dragging was never wired to anything persisted. */}
                <div className="flex flex-1 min-h-0">
                    <div className="w-full flex-1 min-w-[400px]">
                        <div ref={tabsWrapperRef} className="flex-1">
                            <Tabs
                                value={tab}
                                onValueChange={setTab}
                                className="flex flex-col h-full"
                            >
                                <TabsList className="sticky top-0 z-30 px-4 mb-2">
                                    {(items || []).map(
                                        (item: {key?: string; label?: ReactNode}) => (
                                            <TabsTrigger key={item.key} value={String(item.key)}>
                                                {item.label}
                                            </TabsTrigger>
                                        ),
                                    )}
                                </TabsList>
                                {(items || []).map((item: {key?: string; children?: ReactNode}) => (
                                    <TabsContent
                                        key={item.key}
                                        value={String(item.key)}
                                        className="p-3 flex-1 h-full"
                                    >
                                        {item.children}
                                    </TabsContent>
                                ))}
                            </Tabs>
                        </div>
                    </div>
                    {isAnnotationsSectionOpen && (
                        <div className="w-[280px] min-w-[280px] shrink-0">
                            <TraceSidePanel
                                activeTrace={activeTrace as never}
                                activeTraceId={activeId}
                                isLoading={isLoading}
                            />
                        </div>
                    )}
                </div>
            </div>
        </div>
    )
}

export default TraceContent
