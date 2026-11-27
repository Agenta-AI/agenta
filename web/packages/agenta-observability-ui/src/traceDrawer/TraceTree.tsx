import {useCallback, useMemo, useState} from "react"

import {richText, useT} from "@agenta/i18n"
import drawerCatalog from "@agenta/i18n/catalogs/observabilityUi.traceDrawer"
import {filterKeySpans, filterTree} from "@agenta/observability"
import type {TraceSpanNode} from "@agenta/observability"
import {useTraceDrawer} from "@agenta/observability/traceDrawer"
import {formatLatency} from "@agenta/shared/utils"
import {Button, Input, Popover, PopoverContent, PopoverTrigger, SimpleTooltip} from "@agenta/ui/ui"
import {Info, MagnifyingGlass, SlidersHorizontal} from "@phosphor-icons/react"
import {useLocalStorage} from "usehooks-ts"

import {TraceRow} from "../trace/TraceRow"

import CustomTreeComponent from "./CustomTreeComponent"
import {groupTurns, type TraceTurn} from "./groupTurns"
import TraceTreeSettings from "./TraceTreeSettings"
import {TRACE_TREE_DEFAULT_SETTINGS, type TraceTreeSettingsState} from "./traceTreeSettingsTypes"
import type {TraceTreeProps} from "./traceTreeTypes"

const TURN_KEY_PREFIX = "turn:"

/** A row of the "Group turns" view: one turn, its spans under it. */
interface TurnNode {
    span_id: string
    turn: TraceTurn
    children: TraceSpanNode[]
}

type TreeNode = TraceSpanNode | TurnNode

const isTurnNode = (node: TreeNode): node is TurnNode => "turn" in node

const TurnRow = ({turn}: {turn: TraceTurn}) => (
    <div className="flex min-w-0 items-center gap-2">
        <span className="shrink-0 font-mono text-meta text-muted-foreground tabular-nums">
            {turn.index}
        </span>
        <SimpleTooltip title={turn.message}>
            <span className="min-w-0 flex-1 truncate text-label font-medium">{turn.message}</span>
        </SimpleTooltip>
        {turn.durationMs !== null ? (
            <span className="shrink-0 font-mono text-meta text-muted-foreground tabular-nums">
                {formatLatency(turn.durationMs / 1000)}
            </span>
        ) : null}
    </div>
)

const TraceTree = ({activeTrace: active, activeTraceId, selected, setSelected}: TraceTreeProps) => {
    const [searchValue, setSearchValue] = useState("")

    const [traceTreeSettings, setTraceTreeSettings] = useLocalStorage<TraceTreeSettingsState>(
        "traceTreeSettings",
        TRACE_TREE_DEFAULT_SETTINGS,
    )

    const t = useT(drawerCatalog)
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

    // The switch counts the turns of the whole trace, so a search does not disable it.
    const turnCount = useMemo(
        () => groupTurns(treeRoot as TraceSpanNode | undefined)?.turns.length ?? 1,
        [treeRoot],
    )

    // "Group turns": the root's children become one row per turn, each holding its spans.
    const treeData = useMemo<TreeNode | undefined>(() => {
        if (!traceTreeSettings.groupTurns || !displayTree) return displayTree as TraceSpanNode
        const grouped = groupTurns(displayTree as TraceSpanNode)
        if (!grouped) return displayTree as TraceSpanNode
        const turnNodes: TurnNode[] = grouped.turns.map((turn) => ({
            span_id: `${TURN_KEY_PREFIX}${turn.index}`,
            turn,
            children: turn.spans,
        }))
        return {
            ...(displayTree as TraceSpanNode),
            children: [...grouped.leading, ...turnNodes] as TraceSpanNode[],
        }
    }, [displayTree, traceTreeSettings.groupTurns])

    const renderTraceLabel = useCallback(
        (node: TreeNode) =>
            isTurnNode(node) ? (
                <TurnRow turn={node.turn} />
            ) : (
                <TraceRow span={node} metrics={traceTreeSettings} oneLine />
            ),
        [traceTreeSettings],
    )

    if (!activeTrace) {
        return <div className="h-full overflow-hidden flex flex-col" />
    }

    return (
        <div data-testid="trace-tree" className={"h-full overflow-hidden flex flex-col"}>
            {/* Same height and bottom border as the span header beside it (TraceTypeHeader), so
                the two rows read as one. */}
            <div className="box-border h-10 pl-4 pr-2 flex shrink-0 items-center justify-between gap-2 border-0 border-b border-solid border-border-muted">
                {/* antd's borderless Input with a prefix icon; the kit Input has no prefix
                    slot, so the icon sits beside it in a shared row. */}
                <div className="flex items-center gap-2 w-full">
                    <MagnifyingGlass size={14} className="text-muted-foreground shrink-0" />
                    <Input
                        placeholder={t("observabilityUi.traceDrawer.searchInTree")}
                        className="w-full border-0 bg-transparent shadow-none focus-visible:ring-0"
                        value={searchValue}
                        onChange={(e) => setSearchValue(e.target.value)}
                    />
                </div>

                <Popover>
                    <PopoverTrigger asChild>
                        <span className="inline-flex">
                            <SimpleTooltip title={t("observabilityUi.traceDrawer.display")}>
                                <Button
                                    variant="ghost"
                                    size="icon-sm"
                                    aria-label={t("observabilityUi.traceDrawer.display")}
                                >
                                    <SlidersHorizontal size={14} />
                                </Button>
                            </SimpleTooltip>
                        </span>
                    </PopoverTrigger>
                    <PopoverContent side="bottom" align="end" className="!p-0 w-popover-sm">
                        <TraceTreeSettings
                            settings={traceTreeSettings}
                            setSettings={setTraceTreeSettings}
                            showVisibility
                            turnCount={turnCount}
                        />
                    </PopoverContent>
                </Popover>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto">
                <CustomTreeComponent<TreeNode>
                    data={treeData as TreeNode}
                    getKey={(node) => node.span_id}
                    getChildren={(node) => node.children as TreeNode[] | undefined}
                    renderLabel={renderTraceLabel}
                    selectedKey={selected}
                    // A turn row opens the span that holds its message.
                    onSelect={(key, node) =>
                        setSelected(isTurnNode(node) ? (node.turn.spans[0]?.span_id ?? "") : key)
                    }
                    defaultExpanded
                    compact
                />

                {hiddenCount > 0 && (
                    <div className="flex items-center gap-2 mx-2 mb-2 px-3 py-2 rounded-md bg-secondary border border-solid border-border-muted">
                        <Info size={14} className="shrink-0 text-muted-foreground" />
                        <span className="text-meta text-muted-foreground">
                            {richText(
                                t("observabilityUi.traceDrawer.hiddenByKeySpans", {
                                    count: hiddenCount,
                                }),
                                {
                                    count: (text) => (
                                        <span className="font-medium text-foreground">{text}</span>
                                    ),
                                },
                            )}
                        </span>
                        <Button
                            variant="link"
                            size="sm"
                            className="ml-auto !px-0 !h-auto text-meta"
                            onClick={() =>
                                setTraceTreeSettings((prev: TraceTreeSettingsState) => ({
                                    ...prev,
                                    visibility: "all",
                                }))
                            }
                        >
                            {t("observabilityUi.traceDrawer.showAll")}
                        </Button>
                    </div>
                )}
            </div>
        </div>
    )
}

export default TraceTree
