import {useEffect, useMemo, useRef, useState} from "react"

import {Skeleton} from "@agenta/primitive-ui/components/skeleton"
import {Splitter, Tabs, TabsProps} from "antd"
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

    const items: TabsProps["items"] = useMemo(() => {
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
                        <div ref={tabsWrapperRef} className="flex-1">
                            <Tabs
                                defaultActiveKey="overview"
                                activeKey={tab}
                                onChange={setTab}
                                items={items}
                                className={clsx(
                                    "flex flex-col h-full [&_.ant-tabs-nav]:!sticky [&_.ant-tabs-nav]:!top-0 [&_.ant-tabs-nav]:!z-30 [&_.ant-tabs-nav]:!bg-[var(--ag-c-FFFFFF)]",
                                    "[&_.ant-tabs-nav]:mb-2 [&_.ant-tabs-nav]:flex-wrap-reverse [&_.ant-tabs-nav-wrap]:px-4",
                                    "[&_.ant-tabs-content-holder]:p-3 [&_.ant-tabs-content-holder]:flex-1 [&_.ant-tabs-content]:h-full [&_.ant-tabs-tabpane]:h-full",
                                    "[&_.ant-tabs-nav-operations]:!hidden",
                                    "[&_.ant-tabs-extra-content]:pt-[10px] [&_.ant-tabs-extra-content]:pb-[10px] [&_.ant-tabs-extra-content]:pl-4",
                                )}
                            />
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
