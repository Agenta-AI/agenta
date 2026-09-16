import {useCallback, useMemo, useState} from "react"

import {filterKeySpans, filterTree} from "@agenta/observability"
import type {TraceSpanNode} from "@agenta/observability"
import {useTraceDrawer} from "@agenta/observability/traceDrawer"
import {EnhancedButton} from "@agenta/ui/components/presentational"
import {Divider, Input, Popover, PopoverContent, PopoverTrigger} from "@agenta/ui/ui"
import {Info, MagnifyingGlass, SlidersHorizontal} from "@phosphor-icons/react"
import clsx from "clsx"
import {useLocalStorage} from "usehooks-ts"

import {TraceRow} from "../trace/TraceRow"

import CustomTreeComponent from "./CustomTreeComponent"
import TraceTreeSettings from "./TraceTreeSettings"
import type {TraceTreeSettingsState} from "./traceTreeSettingsTypes"
import type {TraceTreeProps} from "./traceTreeTypes"

const treeHeaderClass =
    "[&_.ant-typography]:text-sm [&_.ant-typography]:leading-[1.5714285714285714] [&_.ant-typography]:font-medium"
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
        if (!activeTrace) return undefined

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
        if (!searchValue.trim()) return treeRoot
        const result = filterTree(treeRoot as TraceSpanNode, searchValue)
        return result || {...treeRoot, children: []}
    }, [searchValue, treeRoot])

    // Apply the span visibility filter on top of the searched tree.
    const {displayTree, hiddenCount} = useMemo(() => {
        if ((traceTreeSettings.visibility ?? "key") !== "key" || !searchedTree) {
            return {displayTree: searchedTree, hiddenCount: 0}
        }
        const {tree, hiddenCount: count} = filterKeySpans(searchedTree as TraceSpanNode)
        return {
            displayTree: (tree as TraceSpanNode | undefined) || {...searchedTree, children: []},
            hiddenCount: count,
        }
    }, [searchedTree, traceTreeSettings.visibility])

    const renderTraceLabel = useCallback(
        (node: TraceSpanNode) => <TraceRow span={node} metrics={traceTreeSettings} />,
        [traceTreeSettings],
    )

    if (!activeTrace) {
        return <div className="h-full overflow-hidden flex flex-col" />
    }

    return (
        <div data-testid="trace-tree" className={"h-full overflow-hidden flex flex-col"}>
            <div
                className={clsx(
                    "flex items-center justify-between h-[43px] pl-2 pr-2",
                    treeHeaderClass,
                )}
            >
                {/* antd's borderless Input with a prefix icon; the kit Input has no prefix
                    slot, so the icon sits beside it in a shared row. */}
                <div className="flex items-center gap-2 w-full">
                    <MagnifyingGlass size={14} className="text-gray-500 shrink-0" />
                    <Input
                        placeholder="Search in tree"
                        className="w-full border-0 bg-transparent shadow-none focus-visible:ring-0"
                        value={searchValue}
                        onChange={(e) => setSearchValue(e.target.value)}
                    />
                </div>

                <Popover>
                    <PopoverTrigger asChild>
                        <span className="inline-flex">
                            <EnhancedButton
                                icon={<SlidersHorizontal size={14} />}
                                type="text"
                                size="small"
                            />
                        </span>
                    </PopoverTrigger>
                    {/* antd sized the body 240px and stripped its padding. */}
                    <PopoverContent side="bottom" align="end" className="!p-0 w-[240px]">
                        <TraceTreeSettings
                            settings={traceTreeSettings}
                            setSettings={setTraceTreeSettings}
                            showVisibility
                        />
                    </PopoverContent>
                </Popover>
            </div>
            <Divider className="m-0" />

            <div className="flex-1 min-h-0 overflow-y-auto">
                <CustomTreeComponent
                    data={displayTree as TraceSpanNode}
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
                        <EnhancedButton
                            type="link"
                            size="small"
                            className="ml-auto !px-0 !h-auto text-[12px]"
                            onClick={() =>
                                setTraceTreeSettings((prev: TraceTreeSettingsState) => ({
                                    ...prev,
                                    visibility: "all",
                                }))
                            }
                        >
                            Show all
                        </EnhancedButton>
                    </div>
                )}
            </div>
        </div>
    )
}

export default TraceTree
