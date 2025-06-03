import {useState} from "react"

import {Database} from "@phosphor-icons/react"
import {Button, Divider, Space, Tabs, TabsProps, Typography} from "antd"
import dynamic from "next/dynamic"

import {KeyValuePair} from "@/oss/lib/Types"
import {_AgentaRootsResponse} from "@/oss/services/observability/types"

import AccordionTreePanel from "../../components/AccordionTreePanel"
import {TracesWithAnnotations} from "../../ObservabilityDashboard"

import {useStyles} from "./assets/styles"
import AnnotationTabItem from "./components/AnnotationTabItem"
import OverviewTabItem from "./components/OverviewTabItem"

const TestsetDrawer = dynamic(() => import("../TestsetDrawer/TestsetDrawer"), {ssr: false})

interface TraceContentProps {
    activeTrace: TracesWithAnnotations
}

const TraceContent = ({activeTrace}: TraceContentProps) => {
    const {key, children, nodes, ...filteredTrace} = activeTrace || {}
    const classes = useStyles()
    const [tab, setTab] = useState("overview")
    const [isTestsetDrawerOpen, setIsTestsetDrawerOpen] = useState(false)

    const items: TabsProps["items"] = [
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
    ]

    return (
        <div className={classes.container}>
            <div className="flex-1 flex flex-col overflow-auto">
                <div>
                    <div className="p-4 flex items-center justify-between">
                        <Typography.Text className={classes.title}>
                            {activeTrace?.node?.name}
                        </Typography.Text>

                        <Space>
                            <Button
                                className="flex items-center"
                                onClick={() => setIsTestsetDrawerOpen(true)}
                                disabled={!activeTrace?.key}
                            >
                                <Database size={14} />
                                Add to testset
                            </Button>
                        </Space>
                    </div>
                    <Divider className="m-0" />
                </div>

                <div className="flex-1 flex flex-col overflow-y-auto">
                    <Tabs
                        defaultActiveKey="overview"
                        activeKey={tab}
                        onChange={setTab}
                        items={items}
                        className={classes.tabs}
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
