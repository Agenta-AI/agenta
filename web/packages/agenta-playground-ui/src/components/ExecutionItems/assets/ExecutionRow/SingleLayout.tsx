import React, {useCallback, useEffect, useMemo, useRef, useState} from "react"

import type {SchemaProperty} from "@agenta/entities"
import type {PlaygroundNode} from "@agenta/entities/runnable"
import {runnableBridge} from "@agenta/entities/runnable"
import {RunnableOutputValue} from "@agenta/entity-ui"
import {executionItemController, playgroundController} from "@agenta/playground"
import {getEvaluatorVerdictFromOutput} from "@agenta/playground/utils"
import type {DropdownButtonOption, DropdownButtonOptionStatus} from "@agenta/ui/components"
import {HeightCollapse} from "@agenta/ui/components"
import {CollapsibleGroupHeader, EnhancedButton} from "@agenta/ui/components/presentational"
import {
    ArrowsOutLineHorizontalIcon,
    CopyIcon,
    CopySimpleIcon,
    DatabaseIcon,
    ExamIcon,
    LightningIcon,
    MarkdownLogoIcon,
    MinusCircleIcon,
    PlayIcon,
    RowsIcon,
} from "@phosphor-icons/react"
import {Tag} from "antd"
import clsx from "clsx"
import {useAtomValue, useSetAtom} from "jotai"

import {VariableControlAdapter} from "@agenta/playground-ui/adapters"
import {openPlaygroundFocusDrawerAtom} from "@agenta/playground-ui/state"

import {usePlaygroundUIOptional} from "../../../../context/PlaygroundUIContext"
import {useRepetitionResult} from "../../../../hooks/useRepetitionResult"
import {getShortTestcaseId} from "../../../../utils/testcaseLabel"
import ExecutionResultView from "../../../ExecutionResultView"
import CollapseToggleButton from "../../../shared/CollapseToggleButton"
import {EvaluatorFieldGrid} from "../../../shared/EvaluatorFieldGrid"
import {
    buildSchemaMap,
    extractDisplayEntries,
    formatFieldLabel,
} from "../../../shared/EvaluatorFieldGrid/utils"
import {
    NodeResultCard,
    ensureNodeCardKeyframes,
    type NodeStatus,
} from "../../../shared/NodeResultCard"

import {ExecutionRowRunControl, usePlaygroundNodeLabels} from "./shared"

interface Props {
    rowId: string
    entityId: string
    isChat: boolean
    isBusy: boolean
    isRunning: boolean
    inputOnly?: boolean
    index?: number

    result: unknown
    displayResult?: unknown
    resultHash: string | null
    traceId?: string | null
    status?: "idle" | "pending" | "running" | "success" | "error" | "cancelled" | "skipped"
    errorMessage?: string | null
    runRow: () => void
    cancelRow: () => void
    containerClassName?: string
    appType?: string
    /** Render slot for testset drawer button */
    renderTestsetButton?: (props: {
        results: unknown[]
        icon: boolean
        children: React.ReactNode
    }) => React.ReactNode
}

interface RowHeaderActionsProps {
    rowId: string
    entityId: string
    rowCount: number
    testsetButton?: React.ReactNode
    deleteRow: (rowId: string) => void
    duplicateRow: (rowId: string) => void
    openFocusDrawer: (params: {rowId: string; entityId: string}) => void
    tooltipTitle: string
    className: string
}

const RowHeaderActions = ({
    rowId,
    entityId,
    rowCount,
    testsetButton,
    deleteRow,
    duplicateRow,
    openFocusDrawer,
    tooltipTitle,
    className,
}: RowHeaderActionsProps) => {
    return (
        <div className={className}>
            <EnhancedButton
                icon={<ArrowsOutLineHorizontalIcon size={12} />}
                size="small"
                type="text"
                onClick={() => openFocusDrawer({rowId, entityId})}
                tooltipProps={{title: tooltipTitle}}
            />
            <EnhancedButton
                icon={<MinusCircleIcon size={14} />}
                type="text"
                onClick={() => deleteRow(rowId)}
                size="small"
                disabled={rowCount === 1}
                tooltipProps={{title: "Remove"}}
            />
            <EnhancedButton
                icon={<CopyIcon size={14} />}
                type="text"
                onClick={() => duplicateRow(rowId)}
                size="small"
                tooltipProps={{title: "Duplicate"}}
            />
            {testsetButton}
        </div>
    )
}

/** Reusable step name tag (used in both full and compact modes) */
const StepTag = ({icon, name}: {icon: React.ReactNode; name: string}) => (
    <Tag
        variant="filled"
        className="flex items-center gap-1 !m-0 self-start whitespace-nowrap rounded px-2 py-0.5 text-xs font-medium bg-[#0517290F] text-[#344054] border border-solid border-transparent"
    >
        {icon}
        {name}
    </Tag>
)

/**
 * Compact collapsed summary for a single chain step.
 * Shows step tag + SharedGenerationResultUtils metrics inline.
 */
const StepCollapsedSummary = ({
    rowId,
    entityId,
    stepName,
    icon,
}: {
    rowId: string
    entityId: string
    stepName: string
    icon: React.ReactNode
}) => {
    const providers = usePlaygroundUIOptional()
    const SharedGenerationResultUtils = providers?.SharedGenerationResultUtils

    const resolved = useAtomValue(
        useMemo(
            () =>
                executionItemController.selectors.resolvedResult({
                    entityId,
                    rowId,
                }),
            [entityId, rowId],
        ),
    ) as {traceId?: string | null; result?: unknown} | undefined

    const traceId = resolved?.traceId ?? null

    if (!traceId || !SharedGenerationResultUtils) return null

    return (
        <div className="w-full flex items-center gap-2 rounded-md border border-[var(--ant-color-border-secondary)] border-l-[3px] border-l-[var(--ant-color-primary)] bg-[var(--ant-color-bg-layout)] px-3 py-1.5">
            <StepTag icon={icon} name={stepName} />
            <div className="flex-1 min-w-0 flex items-center overflow-hidden">
                <SharedGenerationResultUtils traceId={traceId} />
            </div>
        </div>
    )
}

// Inject CSS keyframes for NodeResultCard animations (runs once)
ensureNodeCardKeyframes()

/**
 * Self-contained bordered card for a downstream node's execution result.
 * Renders the node name as a legend-style label on the top border,
 * with status-aware border color and animation.
 */
const DownstreamNodeCard = ({
    rowId,
    node,
    nodeName,
    rootEntityId,
}: {
    rowId: string
    node: PlaygroundNode
    nodeName: string
    /** Parent variant's entity ID — scopes the result lookup per-variant */
    rootEntityId: string
}) => {
    // Session key is scoped per-variant: sess:rootEntityId:nodeEntityId
    const scopedEntityId = `${rootEntityId}:${node.entityId}`
    const fullResult = useAtomValue(
        useMemo(
            () =>
                executionItemController.selectors.fullResult({
                    rowId,
                    entityId: scopedEntityId,
                }),
            [rowId, scopedEntityId],
        ),
    ) as {status?: string; output?: unknown; error?: {message: string} | null} | null

    // Read output ports from the runnable bridge (includes per-field schema)
    const outputPorts = useAtomValue(
        useMemo(
            () => runnableBridge.forType(node.entityType).outputPorts(node.entityId),
            [node.entityType, node.entityId],
        ),
    )
    const nodeData = useAtomValue(
        useMemo(() => runnableBridge.data(node.entityId), [node.entityId]),
    )

    const schemaMap = useMemo(() => {
        const map = buildSchemaMap(outputPorts)
        // Enrich score schema with feedback_config constraints (min/max)
        const fbConfig = nodeData?.configuration?.feedback_config as
            | Record<string, unknown>
            | undefined
        if (fbConfig) {
            const jsonSchema = fbConfig.json_schema as
                | {schema?: {properties?: {score?: Record<string, unknown>}}}
                | undefined
            const scoreConstraints = jsonSchema?.schema?.properties?.score
            if (scoreConstraints) {
                const existing = map.score ?? ({} as Record<string, unknown>)
                map.score = {...existing, ...scoreConstraints} as SchemaProperty
            }
        }
        return map
    }, [outputPorts, nodeData])

    const rawStatus = (fullResult?.status ?? "idle") as NodeStatus
    const evaluatorVerdict = getEvaluatorVerdictFromOutput(fullResult?.output)
    const status: NodeStatus =
        rawStatus === "success" && evaluatorVerdict === "fail" ? "error" : rawStatus

    // Idle / cancelled / no result — show expected fields with placeholder dashes
    if (!fullResult || rawStatus === "idle" || rawStatus === "cancelled") {
        return (
            <NodeResultCard name={nodeName} status={status}>
                <EvaluatorFieldGrid entries={null} outputPorts={outputPorts} idle />
            </NodeResultCard>
        )
    }

    // Running / pending -> loading skeleton
    if (rawStatus === "running" || rawStatus === "pending") {
        return (
            <NodeResultCard name={nodeName} status={status}>
                <EvaluatorFieldGrid entries={null} outputPorts={outputPorts} loading />
            </NodeResultCard>
        )
    }

    // Error
    if (rawStatus === "error") {
        const errorMsg =
            typeof fullResult.error === "object" && fullResult.error?.message
                ? fullResult.error.message
                : "Error"
        return (
            <NodeResultCard name={nodeName} status={status}>
                <span className="text-[var(--ant-color-error)] text-xs leading-5">{errorMsg}</span>
            </NodeResultCard>
        )
    }

    // Skipped — show explanation message (e.g., missing required inputs)
    if (rawStatus === "skipped") {
        const skipMsg =
            typeof fullResult.error === "object" && fullResult.error?.message
                ? fullResult.error.message
                : "Skipped"
        return (
            <NodeResultCard name={nodeName} status={status}>
                <span className="text-[var(--ant-color-text-tertiary)] text-xs leading-5 italic">
                    {skipMsg}
                </span>
            </NodeResultCard>
        )
    }

    // Success -> extract and display value(s)
    const entries = extractDisplayEntries(fullResult.output)
    const completedStatus: NodeStatus = evaluatorVerdict === "fail" ? "error" : "success"

    if (!entries || entries.length === 0) {
        return (
            <NodeResultCard name={nodeName} status={completedStatus}>
                <span className="text-xs leading-5">—</span>
            </NodeResultCard>
        )
    }

    return (
        <NodeResultCard name={nodeName} status={completedStatus}>
            <div
                className="grid items-baseline text-xs leading-5"
                style={{gridTemplateColumns: "auto 1fr", columnGap: 12, rowGap: 6}}
            >
                {entries.map(([key, value]) => (
                    <React.Fragment key={key}>
                        <span className="text-[var(--ant-color-text-tertiary)] whitespace-nowrap leading-5">
                            {formatFieldLabel(key)}:
                        </span>
                        <span className="break-words min-w-0 leading-5">
                            <RunnableOutputValue value={value} schema={schemaMap[key]} />
                        </span>
                    </React.Fragment>
                ))}
            </div>
        </NodeResultCard>
    )
}

const CopyVariableButton = ({rowId, variableKey}: {rowId: string; variableKey: string}) => {
    const value = useAtomValue(
        useMemo(
            () =>
                executionItemController.selectors.testcaseCellValue({
                    testcaseId: rowId,
                    column: variableKey,
                }),
            [rowId, variableKey],
        ),
    ) as string

    return (
        <EnhancedButton
            size="small"
            type="text"
            icon={<CopySimpleIcon size={14} />}
            onClick={() => navigator.clipboard.writeText(value)}
            tooltipProps={{title: "Copy"}}
        />
    )
}

const SingleView = ({
    rowId,
    entityId,
    isChat,
    isBusy,
    isRunning,
    inputOnly,
    result,
    displayResult,
    resultHash,
    traceId,
    status = "idle",
    errorMessage = null,
    runRow,
    cancelRow,
    containerClassName,
    appType,
    index,
    renderTestsetButton,
}: Props) => {
    const variableIds = useAtomValue(executionItemController.selectors.variableKeys) as string[]
    const schemaInputKeys = useAtomValue(
        executionItemController.selectors.schemaInputKeys,
    ) as string[]
    const runnableQuery = useAtomValue(useMemo(() => runnableBridge.query(entityId), [entityId]))

    // Chain nodes for per-step execution
    const nodes = useAtomValue(useMemo(() => playgroundController.selectors.nodes(), [])) as
        | PlaygroundNode[]
        | null
    const isChain = (nodes?.length ?? 0) > 1

    const {getNodeLabel} = usePlaygroundNodeLabels(nodes)

    // Per-step execution action
    const runRowStepAction = useSetAtom(executionItemController.actions.runRowStep)

    // Sorted chain nodes (stable reference)
    const sortedNodes = useMemo(
        () => (nodes ? [...nodes].sort((a, b) => a.depth - b.depth) : []),
        [nodes],
    )

    // Ordered entity IDs for the chain status selector
    const entityIds = useMemo(() => sortedNodes.map((n) => n.entityId), [sortedNodes])

    // Single composite chain execution status — replaces manual per-node status derivation
    const chainStatus = useAtomValue(
        useMemo(
            () => executionItemController.selectors.chainExecutionStatus({rowId, entityIds}),
            [rowId, entityIds],
        ),
    )

    // Derive the human-readable label for the currently running step
    const runningStepLabel = useMemo(() => {
        const activeId = chainStatus.activeEntityId
        if (!activeId) return null
        const activeNode = sortedNodes.find((n) => n.entityId === activeId)
        if (!activeNode) return null
        return getNodeLabel(activeNode)
    }, [chainStatus.activeEntityId, getNodeLabel, sortedNodes])

    // Whether the primary entity has a successful run (gates downstream step execution)
    const hasSuccessfulRun = chainStatus.statuses[entityId] === "success"

    // Human-readable label for the primary (depth-0) node
    const primaryNodeLabel = useMemo(() => {
        const primary = sortedNodes[0]
        if (!primary) return "Output"
        return getNodeLabel(primary)
    }, [getNodeLabel, sortedNodes])

    // Build dropdown options for per-step execution
    const stepOptions: DropdownButtonOption[] = useMemo(() => {
        if (!isChain) return []
        return sortedNodes.map((node, index) => {
            const isDownstream = index > 0
            const canRun = isDownstream ? hasSuccessfulRun : true
            return {
                key: node.entityId,
                label: `Run ${getNodeLabel(node)}`,
                icon: <PlayIcon size={14} />,
                disabled: !canRun,
                status: (chainStatus.statuses[node.entityId] ??
                    "idle") as DropdownButtonOptionStatus,
            }
        })
    }, [chainStatus.statuses, getNodeLabel, hasSuccessfulRun, isChain, sortedNodes])

    // Run the full chain — triggers execution from the primary entity.
    // The chain runner handles the full topological order internally.
    const handleRunChain = useCallback(() => {
        runRow()
    }, [runRow])

    // Run a specific chain step — always dispatches from the primary entity,
    // with targetNodeId scoping execution to just that stage.
    const handleStepSelect = useCallback(
        (key: string) => {
            runRowStepAction({rowId, entityId, targetNodeId: key})
        },
        [runRowStepAction, rowId, entityId],
    )

    const providers = usePlaygroundUIOptional()
    const SyncStateTagSlot = providers?.renderSyncStateTag
    const loadableId = useAtomValue(
        useMemo(() => playgroundController.selectors.loadableId(), []),
    ) as string | null

    const openFocusDrawer = useSetAtom(openPlaygroundFocusDrawerAtom)
    const {currentResult, repetitionProps} = useRepetitionResult({
        rowId,
        entityId,
        result,
    })
    const currentDisplayResult =
        status === "error"
            ? {error: errorMessage ?? "Error"}
            : (displayResult ?? currentResult ?? null)
    const primaryNodeStatus = useMemo<NodeStatus>(() => {
        if (isBusy || status === "running" || status === "pending") return "running"
        if (status === "error") return "error"
        if (status === "cancelled") return "cancelled"
        if (status === "skipped") return "skipped"
        if (status === "success") return "success"
        return currentDisplayResult ? "success" : "idle"
    }, [isBusy, status, currentDisplayResult])

    // Feedback config for schema-aware result rendering
    const primaryData = useAtomValue(useMemo(() => runnableBridge.data(entityId), [entityId]))
    const feedbackConfig =
        (primaryData?.configuration?.feedback_config as Record<string, unknown>) ?? null

    // Version and draft state for the primary node label
    const primaryVersion = (primaryData as Record<string, unknown> | null)?.version as
        | number
        | undefined
    const primaryIsDirty = useAtomValue(useMemo(() => runnableBridge.isDirty(entityId), [entityId]))

    const executionRowIds = useAtomValue(
        executionItemController.selectors.executionRowIds,
    ) as string[]
    const testCaseLabel = useMemo(
        () => `testcase ${index !== undefined ? index + 1 : getShortTestcaseId(rowId)}`,
        [rowId, index],
    )

    // Delete and duplicate handlers
    const deleteRow = useSetAtom(executionItemController.actions.deleteRow)
    const duplicateRow = useSetAtom(executionItemController.actions.duplicateRow)
    const rowCount = executionRowIds?.length || 0

    // Check if there are results for the add to testset button
    const hasResults = useMemo(() => {
        return Boolean(resultHash && result)
    }, [resultHash, result])

    // Global collapse state from header (collapse-all / expand-all)
    const isAllCollapsed = useAtomValue(executionItemController.selectors.allRowsCollapsed)

    // Local override: null = follow global, boolean = individual toggle
    const [localCollapsed, setLocalCollapsed] = useState<boolean | null>(null)

    // Reset local override when global state changes
    useEffect(() => {
        setLocalCollapsed(null)
    }, [isAllCollapsed])

    const isCollapsed = localCollapsed ?? isAllCollapsed
    const setIsCollapsed = (value: boolean | ((prev: boolean) => boolean)) => {
        setLocalCollapsed(typeof value === "function" ? value(isCollapsed) : value)
    }

    // Collapse state for individual input/output components
    const [collapsedVariableInputs, setCollapsedVariableInputs] = useState<Record<string, boolean>>(
        {},
    )
    // Stable ref map for variable container overflow detection
    const variableRefsMap = useRef<Map<string, React.RefObject<HTMLDivElement | null>>>(new Map())
    const getVariableRef = useCallback((id: string) => {
        if (!variableRefsMap.current.has(id)) {
            variableRefsMap.current.set(id, React.createRef<HTMLDivElement>())
        }
        return variableRefsMap.current.get(id)!
    }, [])

    const [markdownToggles, setMarkdownToggles] = useState<
        Record<string, (() => void) | undefined>
    >({})

    const toggleVariableInputCollapse = useCallback((id: string) => {
        setCollapsedVariableInputs((prev) => ({...prev, [id]: !prev[id]}))
    }, [])
    const [isInitialLoadSettled, setIsInitialLoadSettled] = useState(false)
    const [hasInteractedWithCollapse, setHasInteractedWithCollapse] = useState(false)
    const isExecutionExpanded = inputOnly || !isCollapsed
    const isWaitingForVariableControls =
        variableIds.length === 0 && (schemaInputKeys.length > 0 || Boolean(runnableQuery.isPending))
    const collapseDurationMs = hasInteractedWithCollapse ? 300 : 0

    useEffect(() => {
        if (isInitialLoadSettled) return
        if (runnableQuery.isPending) return
        if (schemaInputKeys.length > 0 && variableIds.length === 0) return

        const frameId = requestAnimationFrame(() => {
            setIsInitialLoadSettled(true)
        })
        return () => cancelAnimationFrame(frameId)
    }, [isInitialLoadSettled, runnableQuery.isPending, schemaInputKeys.length, variableIds.length])

    if (inputOnly && variableIds.length === 0) {
        return null
    }

    const testsetButton = renderTestsetButton?.({
        results: result ? [result] : [],
        icon: false,
        children: (
            <EnhancedButton
                icon={<DatabaseIcon size={14} />}
                type="text"
                size="small"
                disabled={!hasResults}
                tooltipProps={{title: "Add to testset"}}
            />
        ),
    })

    return (
        <div
            className={clsx([
                "flex flex-col gap-1",
                "group/item",
                isCollapsed ? "px-4 pt-4 pb-2" : "p-4",
                {"gap-4": variableIds.length > 0 && !isCollapsed},
                containerClassName,
            ])}
        >
            {!inputOnly && (
                <div className="w-full flex items-center gap-2 mb-0 group/header">
                    <CollapsibleGroupHeader
                        label={testCaseLabel}
                        isCollapsed={isCollapsed}
                        onClick={() => {
                            setHasInteractedWithCollapse(true)
                            setIsCollapsed((prev) => !prev)
                        }}
                        className="text-gray-500 shrink-0"
                        renderLabel={(label) => (
                            <Tag
                                variant="filled"
                                className="flex items-center gap-1 !m-0 whitespace-nowrap rounded px-2 py-0.5 text-xs bg-[#0517290F] text-[#344054] border border-solid border-transparent cursor-pointer select-none hover:bg-[#0517291A] transition-colors"
                                onClick={(e) => {
                                    e.stopPropagation()
                                    openFocusDrawer({rowId, entityId})
                                }}
                            >
                                <RowsIcon size={12} />
                                {label}
                            </Tag>
                        )}
                    />
                    {SyncStateTagSlot && loadableId && (
                        <SyncStateTagSlot rowId={rowId} loadableId={loadableId} />
                    )}
                    <div className="flex-1" />
                    <RowHeaderActions
                        rowId={rowId}
                        entityId={entityId}
                        rowCount={rowCount}
                        testsetButton={testsetButton}
                        deleteRow={deleteRow}
                        duplicateRow={duplicateRow}
                        openFocusDrawer={openFocusDrawer}
                        tooltipTitle={
                            isCollapsed
                                ? "Open details"
                                : repetitionProps
                                  ? "View all repeats"
                                  : "Open details"
                        }
                        className={clsx(
                            "flex items-center gap-1 opacity-0 transition-opacity",
                            isCollapsed
                                ? "group-hover/item:opacity-100"
                                : "group-hover/header:opacity-100",
                        )}
                    />
                    <ExecutionRowRunControl
                        showDropdown={isChain}
                        stepOptions={stepOptions}
                        isBusy={chainStatus.isBusy}
                        isRunning={!!isRunning}
                        runningStepLabel={runningStepLabel}
                        onRun={handleRunChain}
                        onCancel={cancelRow}
                        onOptionSelect={handleStepSelect}
                        dataTour="run-button"
                    />
                </div>
            )}

            <HeightCollapse
                open={isExecutionExpanded}
                className={clsx({"pointer-events-none": !isExecutionExpanded})}
                contentClassName="w-full"
                durationMs={collapseDurationMs}
                animate={hasInteractedWithCollapse}
            >
                <div
                    className={clsx("flex flex-col gap-4 w-full", {
                        "flex flex-col gap-4 w-full": isChat,
                    })}
                >
                    {variableIds.length > 0 && (
                        <div className="flex flex-col gap-2 w-full">
                            {variableIds.map((id) => {
                                const isVariableInputCollapsed =
                                    collapsedVariableInputs[id] || false
                                return (
                                    <div
                                        key={id}
                                        className={clsx([
                                            "relative group/item px-0 w-full",
                                            "hover:[&_.collapse-icon]:opacity-100",
                                        ])}
                                    >
                                        <VariableControlAdapter
                                            entityId={entityId}
                                            variableKey={id}
                                            rowId={rowId}
                                            appType={appType}
                                            collapsed={isVariableInputCollapsed}
                                            containerRef={getVariableRef(id)}
                                            className="*:!border-none w-full overflow-hidden"
                                            onMarkdownToggleReady={(toggle) => {
                                                setMarkdownToggles((prev) => ({
                                                    ...(prev[id] === (toggle ?? undefined)
                                                        ? prev
                                                        : {
                                                              ...prev,
                                                              [id]: toggle ?? undefined,
                                                          }),
                                                }))
                                            }}
                                            headerActions={
                                                <>
                                                    <EnhancedButton
                                                        size="small"
                                                        type="text"
                                                        icon={<MarkdownLogoIcon size={14} />}
                                                        onClick={() => markdownToggles[id]?.()}
                                                        disabled={!markdownToggles[id]}
                                                        tooltipProps={{
                                                            title: "Preview markdown",
                                                        }}
                                                    />
                                                    <CopyVariableButton
                                                        rowId={rowId}
                                                        variableKey={id}
                                                    />
                                                    <CollapseToggleButton
                                                        className="collapse-icon"
                                                        collapsed={isVariableInputCollapsed}
                                                        onToggle={() =>
                                                            toggleVariableInputCollapse(id)
                                                        }
                                                        contentRef={getVariableRef(id)}
                                                    />
                                                </>
                                            }
                                            editorProps={{enableTokens: false}}
                                        />
                                    </div>
                                )
                            })}
                        </div>
                    )}
                </div>
                {!inputOnly && !isWaitingForVariableControls ? (
                    <div
                        className={clsx([
                            "w-full flex flex-col gap-3 pb-2 relative group/output",
                            "border-0 border-t border-solid border-[rgba(5,23,41,0.06)] pt-3",
                        ])}
                    >
                        {/* Primary node */}
                        <NodeResultCard
                            name={primaryNodeLabel}
                            version={primaryVersion}
                            isDraft={primaryIsDirty}
                            status={primaryNodeStatus}
                        >
                            <div
                                className={clsx(
                                    "min-w-0",
                                    !currentDisplayResult && !isBusy && "text-[#bdc7d1]",
                                )}
                            >
                                <ExecutionResultView
                                    isRunning={isBusy}
                                    currentResult={currentDisplayResult}
                                    traceId={traceId ?? null}
                                    repetitionProps={repetitionProps}
                                    feedbackConfig={feedbackConfig}
                                />
                            </div>
                        </NodeResultCard>
                        {/* Downstream nodes: only render when primary has been run */}
                        {(() => {
                            if (!currentResult && !isBusy) return null
                            const downstreamNodes = nodes?.filter(
                                (n) => n.depth > 0 && n.entityId !== entityId,
                            )
                            if (!downstreamNodes?.length) return null
                            return downstreamNodes.map((node) => {
                                return (
                                    <DownstreamNodeCard
                                        key={node.entityId}
                                        rowId={rowId}
                                        node={node}
                                        nodeName={getNodeLabel(node)}
                                        rootEntityId={entityId}
                                    />
                                )
                            })
                        })()}
                    </div>
                ) : null}
            </HeightCollapse>

            {/* Collapsed chain summary: compact step tags + metrics visible when collapsed */}
            {!inputOnly && isChain && isCollapsed && (
                <div className="w-full flex flex-col gap-2">
                    <StepCollapsedSummary
                        rowId={rowId}
                        entityId={entityId}
                        stepName={primaryNodeLabel}
                        icon={<LightningIcon size={12} weight="fill" />}
                    />
                    {nodes
                        ?.filter((n) => n.depth > 0 && n.entityId !== entityId)
                        .map((node) => {
                            return (
                                <StepCollapsedSummary
                                    key={node.entityId}
                                    rowId={rowId}
                                    entityId={`${entityId}:${node.entityId}`}
                                    stepName={getNodeLabel(node)}
                                    icon={<ExamIcon size={12} />}
                                />
                            )
                        })}
                </div>
            )}
        </div>
    )
}

export default SingleView
