import React, {useCallback, useEffect, useMemo, useRef, useState} from "react"

import type {SchemaProperty} from "@agenta/entities"
import {runnableBridge} from "@agenta/entities/runnable"
import type {PlaygroundNode} from "@agenta/entities/runnable"
import {RunnableOutputValue} from "@agenta/entity-ui"
import {executionItemController, playgroundController} from "@agenta/playground"
import {DropdownButton, HeightCollapse} from "@agenta/ui/components"
import type {DropdownButtonOption, DropdownButtonOptionStatus} from "@agenta/ui/components"
import {
    CollapsibleGroupHeader,
    EnhancedButton,
    RunButton,
} from "@agenta/ui/components/presentational"
import {LoadingOutlined} from "@ant-design/icons"
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
import {atom} from "jotai"
import {useAtomValue, useSetAtom} from "jotai"

import {VariableControlAdapter} from "@agenta/playground-ui/adapters"
import {openPlaygroundFocusDrawerAtom} from "@agenta/playground-ui/state"

import {usePlaygroundUIOptional} from "../../../../context/PlaygroundUIContext"
import {useRepetitionResult} from "../../../../hooks/useRepetitionResult"
import ExecutionResultView from "../../../ExecutionResultView"
import CollapseToggleButton from "../../../shared/CollapseToggleButton"

interface Props {
    rowId: string
    entityId: string
    isChat: boolean
    isBusy: boolean
    isRunning: boolean
    inputOnly?: boolean

    result: unknown
    resultHash: string | null
    traceId?: string | null
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

/** Convert snake_case/camelCase key to human-readable label */
function formatLabel(key: string): string {
    return key
        .replace(/_/g, " ")
        .replace(/([a-z])([A-Z])/g, "$1 $2")
        .replace(/^./, (c) => c.toUpperCase())
}

/** Flat row for evaluator result: tag on the left, content (single or stacked) on the right */
const EvaluatorResultRow = ({
    name,
    content,
    isPlaceholder,
}: {
    name: string
    content: React.ReactNode
    isPlaceholder?: boolean
}) => (
    <div className="flex items-start gap-2">
        <div className="shrink-0 h-6 flex items-center">
            <Tag
                variant="filled"
                className="!m-0 rounded-[6px] px-2 py-[1px] text-xs leading-[22px] bg-[#0517290F] text-[#344054] border border-solid border-transparent"
            >
                {name}
            </Tag>
        </div>
        <div
            className={clsx(
                "flex-1 min-w-0 text-xs leading-5 break-words",
                isPlaceholder ? "text-[#bdc7d1]" : "text-[var(--ant-color-text)]",
            )}
        >
            {content}
        </div>
    </div>
)

/**
 * Renders a single downstream node's execution result (e.g. evaluator output).
 * Flat row layout: [Tag (name)] [Content (value / placeholder)]
 *
 * Uses the runnable bridge output ports to get per-field schemas,
 * then renders values with schema-aware formatting via RunnableOutputValue.
 */
const DownstreamNodeResult = ({
    rowId,
    node,
    nodeName,
}: {
    rowId: string
    node: PlaygroundNode
    nodeName: string
}) => {
    const fullResult = useAtomValue(
        useMemo(
            () =>
                executionItemController.selectors.fullResult({
                    rowId,
                    entityId: node.entityId,
                }),
            [rowId, node.entityId],
        ),
    ) as {status?: string; output?: unknown; error?: {message: string} | null} | null

    // Read output ports from the runnable bridge (includes per-field schema)
    const outputPorts = useAtomValue(
        useMemo(
            () => runnableBridge.forType(node.entityType).outputPorts(node.entityId),
            [node.entityType, node.entityId],
        ),
    )

    // Build a schema map: { fieldKey -> SchemaProperty }
    const schemaMap = useMemo(() => {
        const map: Record<string, SchemaProperty | undefined> = {}
        for (const port of outputPorts) {
            map[port.key] = port.schema as SchemaProperty | undefined
        }
        return map
    }, [outputPorts])

    const status = fullResult?.status ?? "idle"

    // Idle / cancelled / no result -> "Pending run" placeholder
    if (!fullResult || status === "idle" || status === "cancelled") {
        return <EvaluatorResultRow name={nodeName} content="Pending run" isPlaceholder />
    }

    // Running / pending -> spinner + "Running..."
    if (status === "running" || status === "pending") {
        return (
            <EvaluatorResultRow
                name={nodeName}
                content={
                    <span className="flex items-center gap-1 text-[#bdc7d1]">
                        <LoadingOutlined style={{fontSize: 12}} spin />
                        Running...
                    </span>
                }
                isPlaceholder
            />
        )
    }

    // Error -> red error text
    if (status === "error") {
        const errorMsg =
            typeof fullResult.error === "object" && fullResult.error?.message
                ? fullResult.error.message
                : "Error"
        return (
            <EvaluatorResultRow
                name={nodeName}
                content={<span className="text-[var(--ant-color-error)]">{errorMsg}</span>}
            />
        )
    }

    // Success -> extract and display value(s)
    // Response shapes vary by entity type:
    //   legacyEvaluator: output.response.data.outputs = {score, reasoning, ...}
    //   evaluatorRevision: output.response.outputs = {score, reasoning, ...}
    //   generic: output.response = {key: value, ...}
    const output = fullResult.output as Record<string, unknown> | undefined
    const responseData = output?.response as Record<string, unknown> | undefined
    const nestedData = responseData?.data as Record<string, unknown> | undefined
    const displayData = nestedData?.outputs ?? responseData?.outputs ?? nestedData ?? responseData

    if (!displayData || typeof displayData !== "object") {
        return <EvaluatorResultRow name={nodeName} content="—" />
    }

    const entries = Object.entries(displayData).filter(([, v]) => v !== undefined && v !== null)

    if (entries.length === 0) {
        return <EvaluatorResultRow name={nodeName} content="—" />
    }

    // Single field: show value directly with schema-aware rendering
    if (entries.length === 1) {
        const [key, value] = entries[0]
        return (
            <EvaluatorResultRow
                name={nodeName}
                content={<RunnableOutputValue value={value} schema={schemaMap[key]} />}
            />
        )
    }

    // Multi-field: tag once on the left, stacked fields on the right
    return (
        <EvaluatorResultRow
            name={nodeName}
            content={
                <div
                    className="grid items-baseline text-xs leading-5"
                    style={{gridTemplateColumns: "auto 1fr", columnGap: 12, rowGap: 4}}
                >
                    {entries.map(([key, value]) => (
                        <React.Fragment key={key}>
                            <span className="text-[var(--ant-color-text-tertiary)] whitespace-nowrap leading-5">
                                {formatLabel(key)}:
                            </span>
                            <span className="break-words min-w-0 leading-5">
                                <RunnableOutputValue value={value} schema={schemaMap[key]} />
                            </span>
                        </React.Fragment>
                    ))}
                </div>
            }
        />
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
    resultHash,
    traceId,
    runRow,
    cancelRow,
    containerClassName,
    appType,
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

    // Resolve human-readable names for each node from runnableBridge
    const nodeNamesAtom = useMemo(
        () =>
            atom((get) => {
                if (!nodes) return {} as Record<string, string>
                const names: Record<string, string> = {}
                for (const node of nodes) {
                    const data = get(runnableBridge.dataForType(node.entityType, node.entityId))
                    if (data?.name) {
                        names[node.id] = data.name
                    }
                }
                return names
            }),
        [nodes],
    )
    const nodeNames = useAtomValue(nodeNamesAtom)

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
        const resolvedName = nodeNames[activeNode.id]
        return (
            resolvedName ||
            (activeNode.label && !/^[0-9a-f]{8}-/.test(activeNode.label)
                ? activeNode.label
                : activeNode.entityType.charAt(0).toUpperCase() + activeNode.entityType.slice(1))
        )
    }, [chainStatus.activeEntityId, sortedNodes, nodeNames])

    // Whether the primary entity has a successful run (gates downstream step execution)
    const hasSuccessfulRun = chainStatus.statuses[entityId] === "success"

    // Human-readable label for the primary (depth-0) node
    const primaryNodeLabel = useMemo(() => {
        const primary = sortedNodes[0]
        if (!primary) return "Output"
        const resolvedName = nodeNames[primary.id]
        return (
            resolvedName ||
            (primary.label && !/^[0-9a-f]{8}-/.test(primary.label)
                ? primary.label
                : primary.entityType.charAt(0).toUpperCase() + primary.entityType.slice(1))
        )
    }, [sortedNodes, nodeNames])

    // Build dropdown options for per-step execution
    const stepOptions: DropdownButtonOption[] = useMemo(() => {
        if (!isChain) return []
        return sortedNodes.map((node, index) => {
            const isDownstream = index > 0
            const canRun = isDownstream ? hasSuccessfulRun : true
            const resolvedName = nodeNames[node.id]
            const nodeLabel =
                resolvedName ||
                (node.label && !/^[0-9a-f]{8}-/.test(node.label)
                    ? node.label
                    : node.entityType.charAt(0).toUpperCase() + node.entityType.slice(1))
            return {
                key: node.entityId,
                label: `Run ${nodeLabel}`,
                icon: <PlayIcon size={14} />,
                disabled: !canRun,
                status: (chainStatus.statuses[node.entityId] ??
                    "idle") as DropdownButtonOptionStatus,
            }
        })
    }, [isChain, sortedNodes, hasSuccessfulRun, nodeNames, chainStatus.statuses])

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

    const openFocusDrawer = useSetAtom(openPlaygroundFocusDrawerAtom)
    const {currentResult, repetitionProps} = useRepetitionResult({
        rowId,
        entityId,
        result,
    })

    const executionRowIds = useAtomValue(
        executionItemController.selectors.executionRowIds,
    ) as string[]
    const testCaseNumber = useMemo(() => {
        const index = executionRowIds.indexOf(rowId)
        return index >= 0 ? index + 1 : null
    }, [executionRowIds, rowId])

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
    const showHeaderRunHint =
        !inputOnly && !isBusy && !currentResult && !isWaitingForVariableControls

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
                        label={testCaseNumber ? `Test case ${testCaseNumber}` : "Test case"}
                        isCollapsed={isCollapsed}
                        onClick={() => {
                            setHasInteractedWithCollapse(true)
                            setIsCollapsed((prev) => !prev)
                        }}
                        className="text-gray-500 shrink-0"
                        renderLabel={(label) => (
                            <Tag
                                variant="filled"
                                className="flex items-center gap-1 !m-0 whitespace-nowrap rounded px-2 py-0.5 text-xs bg-[#0517290F] text-[#344054] border border-solid border-transparent cursor-default select-none"
                                onClick={(e) => e.stopPropagation()}
                            >
                                <RowsIcon size={12} />
                                {label}
                            </Tag>
                        )}
                    />
                    <div className="flex-1" />
                    <RowHeaderActions
                        rowId={rowId}
                        entityId={entityId}
                        rowCount={rowCount}
                        testsetButton={testsetButton}
                        deleteRow={deleteRow}
                        duplicateRow={duplicateRow}
                        openFocusDrawer={openFocusDrawer}
                        tooltipTitle={isCollapsed ? "Expand results" : "View all repeats"}
                        className={clsx(
                            "flex items-center gap-1 opacity-0 transition-opacity",
                            isCollapsed
                                ? "group-hover/item:opacity-100"
                                : "group-hover/header:opacity-100",
                        )}
                    />
                    {isChain ? (
                        <DropdownButton
                            label={
                                chainStatus.isBusy
                                    ? runningStepLabel
                                        ? `Running ${runningStepLabel}...`
                                        : "Running..."
                                    : "Run"
                            }
                            icon={<PlayIcon size={14} />}
                            size="small"
                            options={stepOptions}
                            onClick={chainStatus.isBusy ? cancelRow : handleRunChain}
                            onOptionSelect={handleStepSelect}
                            loading={chainStatus.isBusy}
                        />
                    ) : !isBusy ? (
                        <RunButton
                            onClick={runRow}
                            disabled={!!isRunning}
                            className="flex"
                            data-tour="run-button"
                        />
                    ) : (
                        <RunButton isCancel onClick={cancelRow} className="flex" />
                    )}
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
                                            "relative group/item px-0 py-2 w-full",
                                            "hover:[&_.collapse-icon]:opacity-100",
                                        ])}
                                    >
                                        <div className="relative w-full">
                                            <VariableControlAdapter
                                                entityId={entityId}
                                                variableKey={id}
                                                key={id}
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
                                    </div>
                                )
                            })}
                        </div>
                    )}
                </div>
                {!inputOnly && !isWaitingForVariableControls ? (
                    <div
                        className={clsx(["w-full flex flex-col gap-3 pb-2 relative group/output"])}
                    >
                        <div className="relative w-full">
                            <ExecutionResultView
                                isRunning={isBusy}
                                currentResult={currentResult}
                                traceId={traceId}
                                repetitionProps={repetitionProps}
                                showEmptyPlaceholder={isChain || !showHeaderRunHint}
                            />
                        </div>
                        {isChain &&
                            (() => {
                                const downstreamNodes = nodes?.filter(
                                    (n) => n.depth > 0 && n.entityId !== entityId,
                                )
                                if (!downstreamNodes?.length) return null
                                return (
                                    <div className="flex flex-col gap-2">
                                        {downstreamNodes.map((node) => {
                                            const resolvedName = nodeNames[node.id]
                                            const label =
                                                resolvedName ||
                                                (node.label && !/^[0-9a-f]{8}-/.test(node.label)
                                                    ? node.label
                                                    : node.entityType.charAt(0).toUpperCase() +
                                                      node.entityType.slice(1))
                                            return (
                                                <DownstreamNodeResult
                                                    key={node.entityId}
                                                    rowId={rowId}
                                                    node={node}
                                                    nodeName={label}
                                                />
                                            )
                                        })}
                                    </div>
                                )
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
                            const resolvedName = nodeNames[node.id]
                            const label =
                                resolvedName ||
                                (node.label && !/^[0-9a-f]{8}-/.test(node.label)
                                    ? node.label
                                    : node.entityType.charAt(0).toUpperCase() +
                                      node.entityType.slice(1))
                            return (
                                <StepCollapsedSummary
                                    key={node.entityId}
                                    rowId={rowId}
                                    entityId={node.entityId}
                                    stepName={label}
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
