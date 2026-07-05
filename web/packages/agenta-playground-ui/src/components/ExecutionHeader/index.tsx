import {memo, useMemo} from "react"

import type {PlaygroundNode} from "@agenta/entities/runnable"
import {
    executionController,
    executionItemController,
    playgroundController,
} from "@agenta/playground"
import {Button} from "@agenta/primitive-ui/components/button"
import {CollapsibleGroupHeader, RunButton} from "@agenta/ui/components/presentational"
import {useRunAllShortcut} from "@agenta/ui/hooks"
import {ArrowsInLineVertical, ArrowsOutLineVertical} from "@phosphor-icons/react"
import {Tooltip} from "antd"
import clsx from "clsx"
import {useAtom, useAtomValue, useSetAtom} from "jotai"

// import RunOptionsPopover from "../ExecutionItems/assets/RunOptionsPopover"

export interface ExecutionHeaderProps {
    /** Entity ID — when provided, scopes run/results to this single entity (single view).
     *  When omitted, runs all entities (comparison view). */
    entityId?: string
    className?: string
    /** Render slot for testset menu/buttons */
    renderTestsetActions?: (props: {
        entityId?: string
        resultCount: number
        isRunning: boolean
    }) => React.ReactNode
    /** Optional analytics callback for RunOptionsPopover */
    onRepeatCountChange?: (event: string, props: Record<string, unknown>) => void
}

/**
 * Unified execution header for both single and comparison views.
 *
 * Replaces:
 * - GenerationHeader (single view — scoped to one entityId)
 * - GenerationComparisonHeader (comparison view — runs all entities)
 *
 * Behavior adapts based on whether `entityId` is provided:
 * - With entityId: shows collapse toggle, RunOptionsPopover, runs only this entity's rows
 * - Without entityId: runs all entities, aggregates results across all
 */
const ExecutionHeader = ({
    entityId,
    className,
    renderTestsetActions,
    // onRepeatCountChange,
}: ExecutionHeaderProps) => {
    const isComparisonView = !entityId
    const isChatMode = useAtomValue(executionController.selectors.isChatMode) ?? false
    // Per-entity agent detection: an agent panel owns its own composer, so the
    // shell's fan-out controls (Clear / Run all) don't apply — hide them.
    const isAgent = useAtomValue(
        useMemo(() => executionController.selectors.isAgentMode(entityId ?? ""), [entityId]),
    )

    const headerDataSelector = useMemo(
        () =>
            isChatMode && isComparisonView
                ? executionItemController.selectors.headerData("")
                : entityId
                  ? executionItemController.selectors.headerData(entityId)
                  : executionItemController.selectors.aggregatedHeaderData,
        [entityId, isChatMode, isComparisonView],
    )
    const headerData = useAtomValue(headerDataSelector) as {
        resultCount?: number
        isRunning?: boolean
    }
    const resultCount = isChatMode && isComparisonView ? 0 : (headerData?.resultCount ?? 0)
    const isRunning = isChatMode && isComparisonView ? false : Boolean(headerData?.isRunning)

    const runAll = useSetAtom(executionItemController.actions.runAll)
    const cancelAll = useSetAtom(executionItemController.actions.cancelAll)
    const clearAll = useSetAtom(executionItemController.actions.clearAll)
    const canRunAllChat = useAtomValue(executionController.selectors.canRunAllChatComparison)

    // Collapse toggle (single view)
    const [isAllCollapsed, setIsAllCollapsed] = useAtom(
        executionItemController.selectors.allRowsCollapsed,
    )

    // Detect connected evaluators for dynamic tooltip
    const nodes = useAtomValue(
        useMemo(() => playgroundController.selectors.nodes(), []),
    ) as PlaygroundNode[]
    const hasEvaluators = useMemo(
        () => nodes.some((n) => n.depth > 0 && n.entityType === "workflow"),
        [nodes],
    )

    const runTests = () => runAll(entityId ? {entityId} : undefined)
    const canRun = !isChatMode || !isComparisonView || canRunAllChat

    // Agent panels run from the composer (the header is hidden for them, `if (isAgent) return null`
    // below). This hook is registered before that early return, so gate it on `!isAgent` too — else
    // ⌘/Ctrl+Enter still fires runAll in agent mode.
    useRunAllShortcut({isRunning, canRun: !isAgent && canRun, onRun: runTests})

    const runAllTooltip = hasEvaluators
        ? "Run the prompt and evaluators on all test cases."
        : "Run the prompt on all test cases."

    const showCollapseToggle = !isComparisonView
    // const showRunOptions = !isComparisonView && entityId

    // The agent panel owns its own chat composer and has no generation rows, so this execution
    // header (a "Chat" label + collapse toggle + run controls) serves no purpose in agent mode.
    if (isAgent) return null

    return (
        <div
            className={clsx(
                "flex justify-between items-center gap-4 flex-shrink-0 px-4 py-2",
                "border-0 border-b border-solid border-colorBorderSecondary",
                "sticky top-0 z-10",
                isComparisonView
                    ? // control-item-bg-active is derived from colorPrimary, which is the
                      // brand yellow in dark — so the compare header rendered olive and
                      // inconsistent with the single-mode header. In dark, fall back to the
                      // same neutral surface single mode uses. Light keeps the active tint.
                      "h-[40px] bg-[var(--ant-control-item-bg-active)] dark:bg-[var(--ag-c-FFFFFF)]"
                    : "h-[48px] bg-[var(--ag-c-FFFFFF)]",
                className,
            )}
        >
            <div className="flex items-center gap-2">
                {showCollapseToggle ? (
                    <div className="flex items-center">
                        <CollapsibleGroupHeader
                            label={
                                isChatMode
                                    ? "Chat"
                                    : isComparisonView
                                      ? "Generations"
                                      : "Generations"
                            }
                            isCollapsed={isAllCollapsed}
                            onClick={() => setIsAllCollapsed(!isAllCollapsed)}
                            iconSize={16}
                            renderIcon={(collapsed, size) =>
                                collapsed ? (
                                    <ArrowsOutLineVertical size={size} />
                                ) : (
                                    <ArrowsInLineVertical size={size} />
                                )
                            }
                            className="text-[16px] leading-[18px] font-[600] text-nowrap items-center"
                        />
                    </div>
                ) : (
                    <span
                        className={clsx(
                            "text-nowrap",
                            isComparisonView
                                ? "text-base font-medium"
                                : "text-[16px] leading-[18px] font-[600]",
                        )}
                    >
                        {isChatMode ? "Chat" : isComparisonView ? "Generations" : "Generations"}
                    </span>
                )}
            </div>

            <div className="flex items-center gap-2">
                {/* Agent entities drive their run from the panel composer, so the
                    shell's Clear / Run all / Cancel controls are hidden. */}
                {!isAgent && (
                    <Tooltip title="Clear all">
                        <Button
                            onClick={() => clearAll()}
                            disabled={isRunning}
                            variant="outline"
                            size="sm"
                        >
                            Clear
                        </Button>
                    </Tooltip>
                )}

                {/* Testset wiring drives testcase-row runs; the agent lane runs from the panel
                    composer and has no rows, so the testset connector doesn't apply to agents. */}
                {!isAgent && renderTestsetActions?.({entityId, resultCount, isRunning})}

                {!isAgent &&
                    (!isRunning ? (
                        <div className="flex">
                            <Tooltip title={`${runAllTooltip} (Ctrl+Enter / ⌘+Enter)`}>
                                <RunButton
                                    isRunAll
                                    type="primary"
                                    onClick={() => runTests()}
                                    disabled={isRunning || !canRun}
                                    // style={showRunOptions ? {borderRadius: "6px 0 0 6px"} : undefined}
                                />
                            </Tooltip>
                            {/* {showRunOptions && entityId && (
                                <RunOptionsPopover
                                    isRunning={isRunning}
                                    entityId={entityId}
                                    onRepeatCountChange={onRepeatCountChange}
                                />
                            )} */}
                        </div>
                    ) : (
                        <RunButton isCancel onClick={() => cancelAll()} className="flex" />
                    ))}
            </div>
        </div>
    )
}

export default memo(ExecutionHeader)
