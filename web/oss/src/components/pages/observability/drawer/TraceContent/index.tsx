import {useEffect, useMemo, useState} from "react"

import {Database} from "@phosphor-icons/react"
import {Button, Divider, Space, Tabs, TabsProps, Tag, Typography, Tooltip, Skeleton} from "antd"
import clsx from "clsx"
import {getDefaultStore, useAtom, useAtomValue, useSetAtom} from "jotai"
import dynamic from "next/dynamic"

import {
    isDrawerOpenAtom,
    resetTraceDrawerAtom,
    traceDrawerActiveTabAtom,
} from "@/oss/components/Playground/Components/Drawers/TraceDrawer/store/traceDrawerStore"
import TooltipWithCopyAction from "@/oss/components/TooltipWithCopyAction"
import {KeyValuePair} from "@/oss/lib/Types"

import AccordionTreePanel from "../../components/AccordionTreePanel"
import AnnotateDrawerButton from "../AnnotateDrawer/assets/AnnotateDrawerButton"

import {useStyles} from "./assets/styles"
import AnnotationTabItem from "./components/AnnotationTabItem"
import OverviewTabItem from "./components/OverviewTabItem"
import {TraceSpanNode} from "@/oss/services/tracing/types"
import {spanAgDataAtomFamily} from "@/oss/state/newObservability/selectors/tracing"

const TestsetDrawer = dynamic(() => import("../TestsetDrawer/TestsetDrawer"), {ssr: false})

interface TraceContentProps {
    activeTrace?: TraceSpanNode
    traceResponse?: any
    error?: any
    isLoading?: boolean
}

const store = getDefaultStore()

const TraceContent = ({
    activeTrace: active,
    traceResponse,
    error,
    isLoading,
}: TraceContentProps) => {
    const resetDrawer = useSetAtom(resetTraceDrawerAtom)
    const activeTrace = active
    const activeTraceData = useAtomValue(spanAgDataAtomFamily(activeTrace))
    const {key, children, spans, invocationIds, ...filteredTrace} = activeTrace || {}
    const classes = useStyles()
    const [tab, setTab] = useAtom(traceDrawerActiveTabAtom)
    const [isTestsetDrawerOpen, setIsTestsetDrawerOpen] = useState(false)
    const testsetData = useMemo(() => {
        if (!activeTrace?.key) return [] as {data: KeyValuePair; key: string; id: number}[]
        return [
            {
                data: activeTraceData as KeyValuePair,
                key: activeTrace.key,
                id: 1,
            },
        ]
    }, [activeTrace?.key, activeTraceData])

    const loadingContent = (
        <div className="px-4 py-6">
            <Skeleton active paragraph={{rows: 6}} title={false} />
        </div>
    )

    const items: TabsProps["items"] = useMemo(() => {
        if (isLoading && !activeTrace) {
            return [
                {
                    key: "loading",
                    label: <span id="tour-trace-tab-overview">Overview</span>,
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
                    label: <span id="tour-trace-tab-raw">Raw Data</span>,
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
                label: <span id="tour-trace-tab-overview">Overview</span>,
                children: <OverviewTabItem activeTrace={activeTrace} />,
            },
            {
                key: "raw_data",
                label: <span id="tour-trace-tab-raw">Raw Data</span>,
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
                key: "annotations",
                label: <span id="tour-trace-tab-annotations">Annotations</span>,
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
    }, [itemKeys.join("|"), tab, setTab])

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
                <div>
                    <div className="p-4 flex items-center justify-between gap-2">
                        <Tooltip
                            placement="topLeft"
                            title={activeTrace?.span_name || (error ? "Error" : "")}
                            mouseEnterDelay={0.25}
                        >
                            <Typography.Text
                                className={clsx("truncate text-nowrap flex-1", classes.title)}
                            >
                                {activeTrace?.span_name || (error ? "Error" : "")}
                            </Typography.Text>
                        </Tooltip>
                        <TooltipWithCopyAction
                            copyText={activeTrace?.span_id || ""}
                            title="Copy span id"
                            tooltipProps={{placement: "bottom", arrow: true}}
                        >
                            <Tag className="font-mono truncate">{activeTrace?.span_id || "-"}</Tag>
                        </TooltipWithCopyAction>
                    </div>
                    <Divider className="m-0" />
                </div>

                <div className="flex-1 flex flex-col overflow-y-auto">
                    <Tabs
                        defaultActiveKey="overview"
                        activeKey={tab}
                        onChange={setTab}
                        items={items}
                        className={clsx("flex flex-col h-full", classes.tabs)}
                        tabBarExtraContent={
                            <Space className="mr-4">
                                <Button
                                    id="tour-trace-add-testset"
                                    className="flex items-center"
                                    onClick={() => setIsTestsetDrawerOpen(true)}
                                    disabled={!activeTrace?.key}
                                >
                                    <Database size={14} />
                                    Add to testset
                                </Button>

                                <AnnotateDrawerButton
                                    id="tour-trace-annotate-button"
                                    label="Annotate"
                                    data={activeTrace?.annotations || []}
                                    traceSpanIds={{
                                        traceId: activeTrace?.trace_id,
                                        spanId: activeTrace?.span_id,
                                    }}
                                />
                            </Space>
                        }
                    />
                </div>
            </div>
            <TestsetDrawer
                open={isTestsetDrawerOpen && !!activeTrace?.key}
                data={testsetData}
                onClose={() => setIsTestsetDrawerOpen(false)}
            />
        </div>
    )
}

export default TraceContent
