import {useMemo, useState} from "react"

import {Database} from "@phosphor-icons/react"
import {Button, Divider, Space, Tabs, TabsProps, Tag, Typography, Tooltip} from "antd"
import dynamic from "next/dynamic"

import TooltipWithCopyAction from "@/oss/components/TooltipWithCopyAction"
import {KeyValuePair} from "@/oss/lib/Types"
import {TracesWithAnnotations} from "@/oss/services/observability/types"

import AccordionTreePanel from "../../components/AccordionTreePanel"
import AnnotateDrawerButton from "../AnnotateDrawer/assets/AnnotateDrawerButton"

import {useStyles} from "./assets/styles"
import AnnotationTabItem from "./components/AnnotationTabItem"
import OverviewTabItem from "./components/OverviewTabItem"
import clsx from "clsx"

const TestsetDrawer = dynamic(() => import("../TestsetDrawer/TestsetDrawer"), {ssr: false})

interface TraceContentProps {
    activeTrace: TracesWithAnnotations
}

const TraceContent = ({activeTrace}: TraceContentProps) => {
    const {key, children, nodes, ...filteredTrace} = activeTrace || {}
    const classes = useStyles()
    const [tab, setTab] = useState("overview")
    const [isTestsetDrawerOpen, setIsTestsetDrawerOpen] = useState(false)

    const items: TabsProps["items"] = useMemo(
        () => [
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
                key: "annotations",
                label: "Annotations",
                children: <AnnotationTabItem annotations={activeTrace?.annotations || []} />,
            },
        ],
        [activeTrace],
    )

    return (
        <div className={clsx("flex w-full h-full flex-1", classes.container)}>
            <div className="flex-1 flex flex-col overflow-auto">
                <div>
                    <div className="p-4 flex items-center justify-between gap-2">
                        <Tooltip
                            placement="topLeft"
                            title={activeTrace?.node?.name}
                            mouseEnterDelay={0.25}
                        >
                            <Typography.Text
                                className={clsx("truncate text-nowrap flex-1", classes.title)}
                            >
                                {activeTrace?.node?.name}
                            </Typography.Text>
                        </Tooltip>
                        <TooltipWithCopyAction
                            copyText={activeTrace.span_id}
                            title="Copy span id"
                            tooltipProps={{placement: "bottom", arrow: true}}
                        >
                            <Tag className="font-normal truncate"># {activeTrace.span_id}</Tag>
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
                                    className="flex items-center"
                                    onClick={() => setIsTestsetDrawerOpen(true)}
                                    disabled={!activeTrace?.key}
                                >
                                    <Database size={14} />
                                    Add to testset
                                </Button>

                                <AnnotateDrawerButton
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
            {isTestsetDrawerOpen && (
                <TestsetDrawer
                    open={isTestsetDrawerOpen}
                    data={[{data: activeTrace?.data as KeyValuePair, key: activeTrace?.key, id: 1}]}
                    onClose={() => setIsTestsetDrawerOpen(false)}
                />
            )}
        </div>
    )
}

export default TraceContent
