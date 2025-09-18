import {useMemo, useState} from "react"

import {Coins, MagnifyingGlass, PlusCircle, SlidersHorizontal, Timer} from "@phosphor-icons/react"
import {Button, Divider, Input, Popover, Space, Tooltip, Typography} from "antd"
import clsx from "clsx"
import {useLocalStorage} from "usehooks-ts"

import CustomTreeComponent from "@/oss/components/ui/CustomTreeComponent"
import {formatCurrency, formatLatency, formatTokenUsage} from "@/oss/lib/helpers/formatters"
import {_AgentaRootsResponse, NodeStatusCode} from "@/oss/services/observability/types"

import {filterTree} from "../../assets/utils"
import AvatarTreeContent from "../../components/AvatarTreeContent"
import useTraceDrawer from "../hooks/useTraceDrawer"
import TraceTreeSettings from "../TraceTreeSettings"

import {useStyles} from "./assets/styles"
import {TraceTreeProps} from "./assets/types"

export const TreeContent = ({value, settings}: {value: _AgentaRootsResponse; settings: any}) => {
    const {node, metrics, status} = value || {}
    const classes = useStyles()

    return (
        <div className="flex flex-col gap-0.5 truncate" key={node?.id}>
            <Space size={4}>
                <AvatarTreeContent value={value} />
                <Tooltip title={node.name} mouseEnterDelay={0.25}>
                    <Typography.Text
                        className={
                            status?.code === NodeStatusCode.ERROR
                                ? `${classes.treeTitle} text-[#D61010] font-[500]`
                                : classes.treeTitle
                        }
                    >
                        {node?.name}
                    </Typography.Text>
                </Tooltip>
            </Space>

            <Space className={classes.treeContentContainer}>
                {settings.latency && (
                    <Tooltip
                        title={`Latency: ${formatLatency(metrics?.acc?.duration?.total / 1000)}`}
                        mouseEnterDelay={0.25}
                        placement="bottom"
                    >
                        <div className={classes.treeContent}>
                            <Timer />
                            {formatLatency(metrics?.acc?.duration?.total / 1000)}
                        </div>
                    </Tooltip>
                )}

                {settings.cost && (metrics?.unit?.costs?.total || metrics?.acc?.costs?.total) && (
                    <Tooltip
                        title={`Cost: ${formatCurrency(metrics?.unit?.costs?.total || metrics?.acc?.costs?.total)}`}
                        mouseEnterDelay={0.25}
                        placement="bottom"
                    >
                        <div className={classes.treeContent}>
                            <Coins />
                            {formatCurrency(
                                metrics?.unit?.costs?.total || metrics?.acc?.costs?.total,
                            )}
                        </div>
                    </Tooltip>
                )}

                {settings.tokens &&
                    !!(metrics?.unit?.tokens?.total || metrics?.acc?.tokens?.total) && (
                        <Tooltip
                            title={`Tokens: ${formatTokenUsage(metrics?.unit?.tokens?.total || metrics?.acc?.tokens?.total)}`}
                            mouseEnterDelay={0.25}
                            placement="bottom"
                        >
                            <div className={classes.treeContent}>
                                <PlusCircle />
                                {formatTokenUsage(
                                    metrics?.unit?.tokens?.total || metrics?.acc?.tokens?.total,
                                )}
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

    // When a child node is selected, anchor the tree to its top-level parent
    const treeRoot = useMemo(() => {
        if (!activeTrace) return undefined as any
        const root = allTraces.find((t: any) => t?.root?.id === activeTrace?.root?.id)
        return (root as any) || activeTrace
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
            />
        </div>
    )
}

export default TraceTree
