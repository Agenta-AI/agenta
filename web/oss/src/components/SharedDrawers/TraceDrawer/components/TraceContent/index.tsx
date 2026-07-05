import {useEffect, useMemo, useRef, useState} from "react"

import {Skeleton} from "@agenta/primitive-ui/components/skeleton"
import {Tabs, TabsContent, TabsList, TabsTrigger} from "@agenta/primitive-ui/components/tabs"
import {Splitter} from "antd"
import clsx from "clsx"
import {useAtom} from "jotai"

import {TraceSpanDrillInView} from "@/oss/components/DrillInView"
import AccordionTreePanel from "@/oss/components/SharedDrawers/TraceDrawer/components/AccordionTreePanel"
import {traceSidePanelOpenAtom} from "@/oss/components/SharedDrawers/TraceDrawer/store/traceDrawerStore"

import TraceSidePanel from "../TraceSidePanel"

import {getRawTraceSpanData} from "./assets/helpers"
import {TraceContentProps} from "./assets/types"
import AnnotationTabItem from "./components/AnnotationTabItem"
import LinkedSpansTabItem from "./components/LinkedSpansTabItem"
import OverviewTabItem from "./components/OverviewTabItem"
import TraceTypeHeader from "./components/TraceTypeHeader"

const loadingContent = (
    <div className="px-4 py-6">
        <div className="flex w-full flex-col gap-3">
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-3/5" />
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
        const nav = el.querySelector<HTMLElement>('[data-slot="tabs-list"]')
        if (!nav) return
        const observer = new ResizeObserver(() => {
            setTabNavHeight(nav.getBoundingClientRect().height)
        })
        observer.observe(nav)
        // Capture initial height immediately
        setTabNavHeight(nav.getBoundingClientRect().height)
        return () => observer.disconnect()
    }, [])

    const items = useMemo(() => {
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
                traceResponse?.response ?? (errorPayload ? {error: errorPayload} : {})
            return [
                {
                    key: "raw_data",
                    label: "Raw Data",
                    children: (
                        <AccordionTreePanel
                            label={errorPayload ? "Error" : "Raw Data"}
                            value={rawPayload as any}
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
                            <TraceSpanDrillInView
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
    const itemKeys = useMemo(() => (items || []).map((it) => String(it?.key)), [items])
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

                <Splitter className="flex-1 min-h-0">
                    <Splitter.Panel min={400} className="w-full flex-1">
                        <div ref={tabsWrapperRef} className="flex-1 h-full min-h-0">
                            <Tabs
                                value={tab}
                                onValueChange={(value) => setTab(String(value))}
                                className="flex h-full min-h-0 gap-0"
                            >
                                <TabsList
                                    variant="line"
                                    className="sticky top-0 z-30 mb-2 shrink-0 flex-wrap-reverse justify-start bg-[var(--ag-c-FFFFFF)] px-4"
                                >
                                    {items.map((item) => (
                                        <TabsTrigger key={item.key} value={item.key}>
                                            {item.label}
                                        </TabsTrigger>
                                    ))}
                                </TabsList>
                                <div className="min-h-0 flex-1 p-3">
                                    {items.map((item) => (
                                        <TabsContent
                                            key={item.key}
                                            value={item.key}
                                            keepMounted
                                            className="h-full"
                                        >
                                            {item.children}
                                        </TabsContent>
                                    ))}
                                </div>
                            </Tabs>
                        </div>
                    </Splitter.Panel>
                    {isAnnotationsSectionOpen && (
                        <Splitter.Panel min={280} defaultSize={280} collapsible>
                            <TraceSidePanel
                                activeTrace={activeTrace as any}
                                activeTraceId={activeId}
                                isLoading={isLoading}
                            />
                        </Splitter.Panel>
                    )}
                </Splitter>
            </div>
        </div>
    )
}

export default TraceContent
