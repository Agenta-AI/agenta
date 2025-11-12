import {useMemo, useState} from "react"

import {Coins, MagnifyingGlass, PlusCircle, SlidersHorizontal, Timer} from "@phosphor-icons/react"
import {Button, Divider, Input, Popover, Space, Tooltip, Typography} from "antd"
import clsx from "clsx"
import {useLocalStorage} from "usehooks-ts"

import CustomTreeComponent from "@/oss/components/ui/CustomTreeComponent"
import {_AgentaRootsResponse} from "@/oss/services/observability/types"

import {filterTree} from "../../assets/utils"
import AvatarTreeContent from "../../components/AvatarTreeContent"
import useTraceDrawer from "../hooks/useTraceDrawer"
import TraceTreeSettings from "../TraceTreeSettings"

import {useStyles} from "./assets/styles"
import {TraceTreeProps} from "./assets/types"
import {StatusCode, TraceSpanNode} from "@/oss/services/tracing/types"
import {useAtomValue} from "jotai"
import {
    formattedSpanLatencyAtomFamily,
    formattedSpanTokensAtomFamily,
    formattedSpanCostAtomFamily,
} from "@/oss/state/newObservability"

export const TreeContent = ({value, settings}: {value: TraceSpanNode; settings: any}) => {
    const {span_name, span_id, status_code} = value || {}

    const classes = useStyles()

    const formattedTokens = useAtomValue(formattedSpanTokensAtomFamily(value))
    const formattedCost = useAtomValue(formattedSpanCostAtomFamily(value))
    const formattedLatency = useAtomValue(formattedSpanLatencyAtomFamily(value))

    return (
        <div className="flex flex-col gap-0.5 truncate" key={span_id}>
            <Space size={4}>
                <AvatarTreeContent value={value} />
                <Tooltip title={span_name} mouseEnterDelay={0.25}>
                    <Typography.Text
                        className={
                            status_code === StatusCode.STATUS_CODE_ERROR
                                ? `${classes.treeTitle} text-[#D61010] font-[500]`
                                : classes.treeTitle
                        }
                    >
                        {span_name}
                    </Typography.Text>
                </Tooltip>
            </Space>

            <Space className={classes.treeContentContainer}>
                {settings.latency && (
                    <Tooltip
                        title={`Latency: ${formattedLatency}`}
                        mouseEnterDelay={0.25}
                        placement="bottom"
                    >
                        <div className={classes.treeContent}>
                            <Timer />
                            {formattedLatency}
                        </div>
                    </Tooltip>
                )}

                {settings.cost && formattedCost && (
                    <Tooltip
                        title={`Cost: ${formattedCost}`}
                        mouseEnterDelay={0.25}
                        placement="bottom"
                    >
                        <div className={classes.treeContent}>
                            <Coins />
                            {formattedCost}
                        </div>
                    </Tooltip>
                )}

                {settings.tokens && !!formattedTokens && (
                    <Tooltip
                        title={`Tokens: ${formattedTokens}`}
                        mouseEnterDelay={0.25}
                        placement="bottom"
                    >
                        <div className={classes.treeContent}>
                            <PlusCircle />
                            {formattedTokens}
                        </div>
                    </Tooltip>
                )}
            </Space>
        </div>
    )
}

const TraceTree: React.FC<TraceTreeProps> = ({
    activeTrace: active, 
    activeTraceId, 
    selected, 
    setSelected,
    enableTour = false
}) => {
    const classes = useStyles()
    const [searchValue, setSearchValue] = useState("")

    const [traceTreeSettings, setTraceTreeSettings] = useLocalStorage("traceTreeSettings", {
        latency: true,
        cost: true,
        tokens: true,
    })

    const {getTraceById, traces: allTraces} = useTraceDrawer()
    const activeTrace = active || getTraceById(activeTraceId)

    // Keep the tree anchored to its original root so selecting a child node preserves context
    const treeRoot = useMemo(() => {
        if (!activeTrace) return undefined as any

        const nodes = (
            Array.isArray(allTraces) ? allTraces : allTraces ? [allTraces] : []
        ) as TraceSpanNode[]

        const containsSpan = (node: TraceSpanNode | undefined, targetId?: string): boolean => {
            if (!node || !targetId) return false
            if (node.span_id === targetId) return true
            return (node.children || []).some((child) =>
                containsSpan(child as TraceSpanNode, targetId),
            )
        }

        const rootWithContext = nodes.find((candidate) =>
            containsSpan(candidate, activeTrace.span_id),
        )

        if (rootWithContext) {
            return rootWithContext
        }

        return nodes[0] || activeTrace
    }, [activeTrace, allTraces])

    const filteredTree = useMemo(() => {
        if (!searchValue.trim()) return treeRoot as any
        const result = filterTree(treeRoot as any, searchValue)
        return result || {...treeRoot, children: []}
    }, [searchValue, treeRoot])

    if (!activeTrace) {
        return <div className="h-full overflow-hidden flex flex-col" />
    }

    return (
        <div className={"h-full overflow-hidden flex flex-col"}>
            <div className={clsx("flex items-center justify-between", classes.treeHeader)}>
                <Input
                    variant="borderless"
                    placeholder="Search in tree"
                    prefix={<MagnifyingGlass size={16} className="text-gray-500 mr-2" />}
                    className="w-full"
                    value={searchValue}
                    onChange={(e) => setSearchValue(e.target.value)}
                    suffix={
                        <Button
                            size="small"
                            className="text-[#586676]"
                            type="text"
                            onClick={() => setSearchValue("")}
                        >
                            clear
                        </Button>
                    }
                />

                <Popover
                    overlayClassName={classes.popover}
                    trigger="click"
                    content={
                        <TraceTreeSettings
                            settings={traceTreeSettings}
                            setSettings={setTraceTreeSettings}
                        />
                    }
                    placement="bottomRight"
                >
                    <Button icon={<SlidersHorizontal size={14} />} type="text" />
                </Popover>
            </div>
            <Divider type="horizontal" className="m-0" />

            <CustomTreeComponent
                data={filteredTree}
                settings={traceTreeSettings}
                selectedKey={selected}
                onSelect={setSelected}
                enableTour={enableTour}
            />
        </div>
    )
}

export default TraceTree
