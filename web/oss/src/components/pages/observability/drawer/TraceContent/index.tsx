import {useEffect, useMemo, useState} from "react"

import {Tabs, TabsProps, Skeleton, Splitter} from "antd"
import clsx from "clsx"
import {getDefaultStore, useAtom, useSetAtom} from "jotai"

import {
    isDrawerOpenAtom,
    resetTraceDrawerAtom,
} from "@/oss/components/Playground/Components/Drawers/TraceDrawer/store/traceDrawerStore"

import AccordionTreePanel from "../../components/AccordionTreePanel"

import {useStyles} from "./assets/styles"
import AnnotationTabItem from "./components/AnnotationTabItem"
import ConfigurationTabItem from "./components/ConfigurationTabItem"
import OverviewTabItem from "./components/OverviewTabItem"
import {TraceContentProps} from "./assets/types"
import TraceTypeHeader from "./components/TraceTypeHeader"
import TraceSidePanel from "../TraceSidePanel"
import {traceSidePanelOpenAtom} from "./assets/traceAtom"

const store = getDefaultStore()

const loadingContent = (
    <div className="px-4 py-6">
        <Skeleton active paragraph={{rows: 6}} title={false} />
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
    const resetDrawer = useSetAtom(resetTraceDrawerAtom)
    const [isAnnotationsSectionOpen, setIsAnnotationsSectionOpen] = useAtom(traceSidePanelOpenAtom)
    const activeTrace = active
    const {key, children, spans, invocationIds, ...filteredTrace} = activeTrace || {}
    const classes = useStyles()
    const [tab, setTab] = useState("overview")

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
                traceResponse?.response || (errorPayload ? {error: errorPayload} : {})
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
                        />
                    ),
                },
            ]
        }

        return [
            {
                key: "overview",
                label: "Overview",
                children: <OverviewTabItem activeTrace={activeTrace} />,
            },
            {
                key: "raw_data",
                label: "Raw Data",
                children: (
                    <AccordionTreePanel
                        label={"Raw Data"}
                        value={{...filteredTrace}}
                        enableFormatSwitcher
                        fullEditorHeight
                    />
                ),
            },
            {
                key: "configuration",
                label: "Configuration",
                children: <ConfigurationTabItem activeTrace={activeTrace} />,
            },
            {
                key: "linked-span",
                label: "Linked Span",
                children: <AnnotationTabItem annotations={activeTrace?.annotations || []} />,
            },
            {
                key: "annotations",
                label: "Annotations",
                children: <AnnotationTabItem annotations={activeTrace?.annotations || []} />,
            },
        ]
    }, [activeTrace, filteredTrace, isLoading, traceResponse, error])

    // Ensure active tab exists in items; if not, switch to first tab
    const itemKeys = useMemo(() => (items || []).map((it) => String(it?.key)), [items])
    useEffect(() => {
        if (!itemKeys.includes(tab) && itemKeys.length > 0) {
            setTab(itemKeys[0])
        }
    }, [itemKeys.join("|"), tab])

    useEffect(() => {
        return () => {
            const isOpen = store.get(isDrawerOpenAtom)
            if (!isOpen) {
                resetDrawer()
            }
        }
    }, [])

    return (
        <div className={clsx("flex w-full h-full flex-1", classes.container)}>
            <div className="flex-1 flex flex-col overflow-auto">
                <TraceTypeHeader
                    activeTrace={activeTrace}
                    error={error}
                    setSelectedTraceId={setSelectedTraceId}
                    setIsAnnotationsSectionOpen={setIsAnnotationsSectionOpen}
                    isAnnotationsSectionOpen={isAnnotationsSectionOpen}
                    traces={traces}
                />

                <Splitter className="h-[87vh] flex">
                    <Splitter.Panel min={400} className="w-full flex-1">
                        <div className="flex-1">
                            <Tabs
                                defaultActiveKey="overview"
                                activeKey={tab}
                                onChange={setTab}
                                items={items}
                                className={clsx(
                                    "flex flex-col h-full [&_.ant-tabs-nav]:!sticky [&_.ant-tabs-nav]:!top-0 [&_.ant-tabs-nav]:!z-10 [&_.ant-tabs-nav]:!bg-white",
                                    classes.tabs,
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
