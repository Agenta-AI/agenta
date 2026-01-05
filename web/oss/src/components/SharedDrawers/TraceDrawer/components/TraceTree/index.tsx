import {useCallback, useMemo, useState} from "react"

import {Coins, MagnifyingGlass, PlusCircle, SlidersHorizontal, Timer} from "@phosphor-icons/react"
import {Button, Divider, Input, Popover, Space, Tooltip, Typography} from "antd"
import clsx from "clsx"
import {useAtomValue} from "jotai"
import {useLocalStorage} from "usehooks-ts"

import CustomTreeComponent from "@/oss/components/CustomUIs/CustomTreeComponent"
import {filterTree} from "@/oss/components/pages/observability/assets/utils"
import AvatarTreeContent from "@/oss/components/pages/observability/components/AvatarTreeContent"
import {StatusCode, TraceSpanNode} from "@/oss/services/tracing/types"
import {
    formattedSpanCostAtomFamily,
    formattedSpanLatencyAtomFamily,
    formattedSpanTokensAtomFamily,
} from "@/oss/state/newObservability"

import useTraceDrawer from "../../hooks/useTraceDrawer"
import TraceTreeSettings from "../TraceTreeSettings"

import {useStyles} from "./assets/styles"
import {TraceTreeProps} from "./assets/types"

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

const TraceTree = ({activeTrace: active, activeTraceId, selected, setSelected}: TraceTreeProps) => {
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

    const renderTraceLabel = useCallback(
        (node: TraceSpanNode) => <TreeContent value={node} settings={traceTreeSettings} />,
        [traceTreeSettings],
    )

    if (!activeTrace) {
        return <div className="h-full overflow-hidden flex flex-col" />
    }

    return (
        <div className={"h-full overflow-hidden flex flex-col"}>
            <div
                className={clsx(
                    "flex items-center justify-between h-[43px] pl-2 pr-2",
                    classes.treeHeader,
                )}
            >
                <Input
                    variant="borderless"
                    placeholder="Search in tree"
                    prefix={<MagnifyingGlass size={14} className="text-gray-500 mr-2" />}
                    className="w-full"
                    value={searchValue}
                    onChange={(e) => setSearchValue(e.target.value)}
                    allowClear
                />

                <Popover
                    trigger="click"
                    content={
                        <TraceTreeSettings
                            settings={traceTreeSettings}
                            setSettings={setTraceTreeSettings}
                        />
                    }
                    placement="bottomRight"
                    classNames={{body: "!p-0 w-[200px]"}}
                    arrow={false}
                >
                    <Button icon={<SlidersHorizontal size={14} />} type="text" size="small" />
                </Popover>
            </div>
            <Divider orientation="horizontal" className="m-0" />

            <CustomTreeComponent
                data={filteredTree}
                getKey={(node) => node.span_id}
                getChildren={(node) => node.children as TraceSpanNode[] | undefined}
                renderLabel={renderTraceLabel}
                selectedKey={selected}
                onSelect={(key) => setSelected(key)}
                defaultExpanded
            />
        </div>
    )
}

export default TraceTree
