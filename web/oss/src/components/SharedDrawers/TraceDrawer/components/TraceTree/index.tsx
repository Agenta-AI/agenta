import {useCallback, useMemo, useState} from "react"

import {Button} from "@agenta/primitive-ui/components/button"
import {Popover, PopoverContent, PopoverTrigger} from "@agenta/primitive-ui/components/popover"
import {Tooltip, TooltipTrigger, TooltipContent} from "@agenta/primitive-ui/components/tooltip"
import {
    Coins,
    Info,
    MagnifyingGlass,
    PlusCircle,
    SlidersHorizontal,
    Timer,
} from "@phosphor-icons/react"
import {Divider, Input, Space} from "antd"
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
import {TraceTreeSettingsState} from "../TraceTreeSettings/types"

import {filterKeySpans} from "./assets/spanVisibility"
import {TraceTreeProps} from "./assets/types"

const treeTitleClass = "text-xs leading-[1.6666666666666667]"
const treeContentContainerClass = "text-colorTextSecondary"
const treeContentClass = "flex items-center font-mono gap-0.5"

export const TreeContent = ({value, settings}: {value: TraceSpanNode; settings: any}) => {
    const {span_name, span_id, status_code} = value || {}

    const formattedTokens = useAtomValue(formattedSpanTokensAtomFamily(value))
    const formattedCost = useAtomValue(formattedSpanCostAtomFamily(value))
    const formattedLatency = useAtomValue(formattedSpanLatencyAtomFamily(value))

    return (
        <div className="flex flex-col gap-0.5 truncate" key={span_id}>
            <Space size={4}>
                <AvatarTreeContent value={value} />
                <Tooltip>
                    <TooltipTrigger
                        render={
                            <span
                                className={
                                    status_code === StatusCode.STATUS_CODE_ERROR
                                        ? `${treeTitleClass} text-[var(--ag-c-D61010)] font-[500]`
                                        : treeTitleClass
                                }
                            >
                                {span_name}
                            </span>
                        }
                    />
                    <TooltipContent>{span_name}</TooltipContent>
                </Tooltip>
            </Space>

            <Space className={treeContentContainerClass}>
                {settings.latency && (
                    <Tooltip>
                        <TooltipTrigger
                            render={
                                <div className={treeContentClass}>
                                    <Timer />
                                    {formattedLatency}
                                </div>
                            }
                        />
                        <TooltipContent side="bottom">{`Latency: ${formattedLatency}`}</TooltipContent>
                    </Tooltip>
                )}

                {settings.cost && formattedCost && (
                    <Tooltip>
                        <TooltipTrigger
                            render={
                                <div className={treeContentClass}>
                                    <Coins />
                                    {formattedCost}
                                </div>
                            }
                        />
                        <TooltipContent side="bottom">{`Cost: ${formattedCost}`}</TooltipContent>
                    </Tooltip>
                )}

                {settings.tokens && !!formattedTokens && (
                    <Tooltip>
                        <TooltipTrigger
                            render={
                                <div className={treeContentClass}>
                                    <PlusCircle />
                                    {formattedTokens}
                                </div>
                            }
                        />
                        <TooltipContent side="bottom">{`Tokens: ${formattedTokens}`}</TooltipContent>
                    </Tooltip>
                )}
            </Space>
        </div>
    )
}

const TraceTree = ({activeTrace: active, activeTraceId, selected, setSelected}: TraceTreeProps) => {
    const [searchValue, setSearchValue] = useState("")

    const [traceTreeSettings, setTraceTreeSettings] = useLocalStorage<TraceTreeSettingsState>(
        "traceTreeSettings",
        {
            latency: true,
            cost: true,
            tokens: true,
            visibility: "key",
        },
    )

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

    // Tree after the text search filter (the original behaviour).
    const searchedTree = useMemo(() => {
        if (!searchValue.trim()) return treeRoot as any
        const result = filterTree(treeRoot as any, searchValue)
        return result || {...treeRoot, children: []}
    }, [searchValue, treeRoot])

    // Apply the span visibility filter on top of the searched tree.
    const {displayTree, hiddenCount} = useMemo(() => {
        if ((traceTreeSettings.visibility ?? "key") !== "key" || !searchedTree) {
            return {displayTree: searchedTree, hiddenCount: 0}
        }
        const {tree, hiddenCount: count} = filterKeySpans(searchedTree as TraceSpanNode)
        return {displayTree: (tree as any) || {...searchedTree, children: []}, hiddenCount: count}
    }, [searchedTree, traceTreeSettings.visibility])

    const renderTraceLabel = useCallback(
        (node: TraceSpanNode) => <TreeContent value={node} settings={traceTreeSettings} />,
        [traceTreeSettings],
    )

    if (!activeTrace) {
        return <div className="h-full overflow-hidden flex flex-col" />
    }

    return (
        <div className={"h-full overflow-hidden flex flex-col"}>
            <div className={clsx("flex items-center justify-between h-[43px] pl-2 pr-2")}>
                <Input
                    variant="borderless"
                    placeholder="Search in tree"
                    prefix={<MagnifyingGlass size={14} className="text-gray-500 mr-2" />}
                    className="w-full"
                    value={searchValue}
                    onChange={(e) => setSearchValue(e.target.value)}
                    allowClear
                />

                <Popover>
                    <PopoverTrigger render={<Button variant="ghost" size="icon-sm" />}>
                        {<SlidersHorizontal size={14} />}
                    </PopoverTrigger>
                    <PopoverContent side="bottom" align="end" className="w-[240px] p-0">
                        <TraceTreeSettings
                            settings={traceTreeSettings}
                            setSettings={setTraceTreeSettings}
                            showVisibility
                        />
                    </PopoverContent>
                </Popover>
            </div>
            <Divider orientation="horizontal" className="m-0" />

            <div className="flex-1 min-h-0 overflow-y-auto">
                <CustomTreeComponent
                    data={displayTree}
                    getKey={(node) => node.span_id}
                    getChildren={(node) => node.children as TraceSpanNode[] | undefined}
                    renderLabel={renderTraceLabel}
                    selectedKey={selected}
                    onSelect={(key) => setSelected(key)}
                    defaultExpanded
                />

                {hiddenCount > 0 && (
                    <div className="flex items-center gap-2 mx-2 mb-2 px-3 py-2 rounded-md bg-colorFillTertiary border border-solid border-colorBorderSecondary">
                        <Info size={14} className="shrink-0 text-colorTextTertiary" />
                        <span className="text-[12px] text-colorTextSecondary">
                            <span className="font-medium text-colorText">{hiddenCount}</span>{" "}
                            {hiddenCount === 1 ? "span" : "spans"} hidden by key spans
                        </span>
                        <Button
                            className="ml-auto !px-0 !h-auto text-[12px]"
                            onClick={() =>
                                setTraceTreeSettings((prev) => ({...prev, visibility: "all"}))
                            }
                            variant="link"
                            size="sm"
                        >
                            Show all
                        </Button>
                    </div>
                )}
            </div>
        </div>
    )
}

export default TraceTree
