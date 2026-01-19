/**
 * TestcasePanel Component
 *
 * Right panel of the playground that handles testcase execution.
 * Mirrors the "Generations" panel in the current playground design.
 *
 * This panel is purely for EXECUTION context:
 * - Displays testcase data (loaded from connected sources or manually added)
 * - Run buttons for individual and batch execution
 * - Output display for each testcase (including chain results)
 *
 * Note: Data source connections (testset linking) belong in ConfigPanel,
 * not here. This panel only consumes the loaded data.
 */

import {useCallback, useEffect, useMemo, useState} from "react"

import type {TestsetColumn, TestsetRow, StageExecutionResult} from "@agenta/entities/runnable"
import {detectEditorLanguage} from "@agenta/shared"
import {SharedEditor} from "@agenta/ui"
import {CaretDown, CaretRight, Flask, Lightning, Plus, Spinner, Trash} from "@phosphor-icons/react"
import {Button, Empty, Input, Progress, Tag, Typography} from "antd"

import {usePlaygroundUI} from "../../context"
import type {ChainExecutionResult, ChainNodeInfo} from "../types"

const {Text} = Typography

/**
 * Get editor language for output content.
 * Returns undefined for "text" type to maintain existing behavior.
 */
function getOutputLanguage(output: unknown): "json" | "yaml" | "code" | undefined {
    const detected = detectEditorLanguage(output)
    // Editor doesn't support "text" or "markdown", return undefined for plain text display
    if (detected === "text" || detected === "markdown") {
        return undefined
    }
    return detected
}

export interface TestcasePanelProps {
    /** Loadable ID for testcase management */
    loadableId: string
    /** Column definitions (from linked runnable's inputSchema) - EXPECTED inputs */
    columns: TestsetColumn[]
    /** All columns from the testset data - PROVIDED inputs (may include extra fields) */
    suppliedColumns?: {key: string; name: string}[]
    /** All testcase rows */
    rows: TestsetRow[]
    /** Execution results per row (may include chain results) */
    executionResults: Record<string, ChainExecutionResult>
    /** Add a new row */
    onAddRow: (data?: Record<string, unknown>) => void
    /** Update a row's data */
    onUpdateRow: (rowId: string, data: Record<string, unknown>) => void
    /** Remove a row */
    onRemoveRow: (rowId: string) => void
    /** Clear all rows */
    onClearRows: () => void
    /** Execute a single row */
    onExecuteRow: (rowId: string, data: Record<string, unknown>) => void
    /** Execute all rows */
    onExecuteAll?: () => void
    /** Whether execution is in progress */
    isExecuting?: boolean
    /** Chain node info for displaying downstream results */
    chainNodes?: ChainNodeInfo[]
}

/**
 * Format output value for display
 */
function formatOutput(output: unknown): string {
    if (typeof output === "string") return output
    if (output === null || output === undefined) return "—"
    return JSON.stringify(output, null, 2)
}

/**
 * Get status color for result tag
 */
function getStatusColor(status: StageExecutionResult["status"]): string {
    switch (status) {
        case "success":
            return "green"
        case "error":
            return "red"
        case "running":
            return "blue"
        case "pending":
            return "orange"
        default:
            return "default"
    }
}

/**
 * Chain result item showing a downstream node's output with trace info
 */
function ChainResultItem({
    nodeId,
    nodeInfo,
    result,
    stageIndex,
    totalStages,
    SharedGenerationResultUtils,
}: {
    nodeId: string
    nodeInfo?: ChainNodeInfo
    result: StageExecutionResult
    stageIndex?: number
    totalStages?: number
    SharedGenerationResultUtils: React.ComponentType<{
        traceId?: string | null
        showStatus?: boolean
        className?: string
    }>
}) {
    const isEvaluator = nodeInfo?.type === "evaluatorRevision"
    const label = nodeInfo?.label || result.nodeLabel || nodeId
    const outputLanguage = useMemo(() => getOutputLanguage(result.output), [result.output])
    const outputValue = useMemo(() => formatOutput(result.output), [result.output])
    const showStageNumber = stageIndex !== undefined && totalStages !== undefined && totalStages > 1

    return (
        <div className="bg-gray-50 rounded p-3 border border-gray-100">
            {/* Header with stage info and status */}
            <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                    {isEvaluator ? (
                        <Flask size={14} weight="fill" className="text-purple-500" />
                    ) : (
                        <Lightning size={14} weight="fill" className="text-blue-500" />
                    )}
                    <div className="flex items-center gap-1.5">
                        {showStageNumber && (
                            <Text type="secondary" className="text-xs">
                                Stage {stageIndex + 1}:
                            </Text>
                        )}
                        <Text strong className="text-sm">
                            {label}
                        </Text>
                    </div>
                    <Tag color={getStatusColor(result.status)} className="m-0 text-[10px]">
                        {result.status}
                    </Tag>
                </div>

                {/* Trace utilities (latency, tokens, cost, open trace button) */}
                {result.traceId && (
                    <SharedGenerationResultUtils
                        traceId={result.traceId}
                        showStatus={false}
                        className="flex-shrink-0"
                    />
                )}
            </div>

            {/* Running state */}
            {result.status === "running" && (
                <div className="flex items-center gap-2 text-blue-500">
                    <Spinner size={14} className="animate-spin" />
                    <Text type="secondary" className="text-sm">
                        Running...
                    </Text>
                </div>
            )}

            {/* Output content */}
            {result.status === "success" && result.output !== undefined && (
                <div className="mt-1 max-h-24 overflow-auto">
                    <SharedEditor
                        initialValue={outputValue}
                        editorType="border"
                        state="readOnly"
                        disabled
                        editorProps={{
                            codeOnly: !!outputLanguage,
                            language: outputLanguage,
                            readOnly: true,
                            showLineNumbers: false,
                        }}
                        className="text-xs"
                    />
                </div>
            )}

            {/* Error state */}
            {result.status === "error" && result.error && (
                <div className="mt-1 p-2 bg-red-50 rounded border border-red-100">
                    <Text type="danger" className="text-xs">
                        {result.error.message}
                    </Text>
                </div>
            )}
        </div>
    )
}

/**
 * Single testcase row with input fields, run button, and output display
 */
function TestcaseRow({
    row,
    columns,
    extraColumns,
    globalShowExtras,
    globalToggleKey,
    executionResult,
    chainNodes,
    onUpdate,
    onRemove,
    onExecute,
    SharedGenerationResultUtils,
}: {
    row: TestsetRow
    columns: TestsetColumn[]
    /** Extra columns from testset that aren't in expected inputs */
    extraColumns: {key: string; name: string}[]
    /** Global setting for showing extras (from header toggle) */
    globalShowExtras: boolean
    /** Key that changes when global toggle is clicked (to reset local overrides) */
    globalToggleKey: number
    executionResult?: ChainExecutionResult
    chainNodes?: ChainNodeInfo[]
    onUpdate: (data: Record<string, unknown>) => void
    onRemove: () => void
    onExecute: () => void
    SharedGenerationResultUtils: React.ComponentType<{
        traceId?: string | null
        showStatus?: boolean
        className?: string
    }>
}) {
    const [isChainExpanded, setIsChainExpanded] = useState(false)
    // Local override for this row (null = follow global)
    const [localShowExtras, setLocalShowExtras] = useState<boolean | null>(null)

    // Reset local override when global toggle changes
    useEffect(() => {
        setLocalShowExtras(null)
    }, [globalToggleKey])

    // Effective value: local override takes precedence over global
    const showExtras = localShowExtras ?? globalShowExtras
    const hasExtras = extraColumns.length > 0

    const status = executionResult?.status || "idle"
    const isRunning = status === "running" || status === "pending"

    // Memoize output formatting (for single-stage results)
    const outputLanguage = useMemo(
        () => getOutputLanguage(executionResult?.output),
        [executionResult?.output],
    )
    const outputValue = useMemo(
        () => formatOutput(executionResult?.output),
        [executionResult?.output],
    )

    const handleFieldChange = useCallback(
        (key: string, value: string) => {
            onUpdate({...row.data, [key]: value})
        },
        [row.data, onUpdate],
    )

    return (
        <div className="border border-gray-200 rounded-lg bg-white overflow-hidden">
            {/* Input Fields */}
            <div className="p-4 space-y-3">
                <div className="flex items-center justify-between">
                    <Text type="secondary" className="text-xs uppercase tracking-wide">
                        Variables
                    </Text>
                    <div className="flex items-center gap-1">
                        {/* Per-row toggle for extra data */}
                        {hasExtras && (
                            <Button
                                type="text"
                                size="small"
                                onClick={() => setLocalShowExtras(!showExtras)}
                                className="text-xs px-2"
                                title={showExtras ? "Hide extra data" : "Show extra data"}
                            >
                                {showExtras ? (
                                    <CaretDown size={12} className="mr-1" />
                                ) : (
                                    <CaretRight size={12} className="mr-1" />
                                )}
                                +{extraColumns.length}
                            </Button>
                        )}
                        <Button
                            type="text"
                            size="small"
                            danger
                            icon={<Trash size={14} />}
                            onClick={onRemove}
                            title="Remove testcase"
                        />
                    </div>
                </div>

                {columns.length === 0 ? (
                    <Text type="secondary" className="text-sm">
                        No input variables defined. Add {"{{variables}}"} to your prompt.
                    </Text>
                ) : (
                    columns.map((col) => (
                        <div key={col.key} className="space-y-1">
                            <Text className="text-sm font-medium text-blue-600">{col.name}</Text>
                            <Input.TextArea
                                value={(row.data[col.key] as string) ?? ""}
                                onChange={(e) => handleFieldChange(col.key, e.target.value)}
                                placeholder={`Enter ${col.name.toLowerCase()}...`}
                                autoSize={{minRows: 1, maxRows: 4}}
                                className="w-full"
                            />
                        </div>
                    ))
                )}

                {/* Extra Variables - shown when toggle is on */}
                {showExtras && extraColumns.length > 0 && (
                    <div className="pt-2 border-t border-gray-100 space-y-2">
                        <Text type="secondary" className="text-xs uppercase tracking-wide">
                            Other Data
                        </Text>
                        {extraColumns.map((col) => (
                            <div key={col.key} className="space-y-1">
                                <Text className="text-sm font-medium text-gray-500">
                                    {col.name}
                                </Text>
                                <Input.TextArea
                                    value={(row.data[col.key] as string) ?? ""}
                                    onChange={(e) => handleFieldChange(col.key, e.target.value)}
                                    placeholder={`Enter ${col.name.toLowerCase()}...`}
                                    autoSize={{minRows: 1, maxRows: 4}}
                                    className="w-full"
                                />
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Run Button */}
            <div className="px-4 py-2 bg-gray-50 border-t border-gray-200">
                <Button
                    type="primary"
                    icon={<CaretRight size={14} weight="fill" />}
                    onClick={onExecute}
                    loading={isRunning}
                    disabled={columns.length === 0}
                    size="small"
                >
                    Run
                </Button>
            </div>

            {/* Output Section */}
            {executionResult && status !== "idle" && (
                <div className="border-t border-gray-200">
                    {/* Chain Progress Header (when running multi-stage) */}
                    {(status === "running" || status === "pending") &&
                        executionResult.isChain &&
                        executionResult.chainProgress && (
                            <div className="px-4 py-3 bg-blue-50 border-b border-blue-100">
                                <div className="flex items-center gap-3">
                                    <Spinner size={16} className="animate-spin text-blue-500" />
                                    <div className="flex-1">
                                        <div className="flex items-center gap-2 mb-1">
                                            <Text strong className="text-sm text-blue-700">
                                                Running Stage{" "}
                                                {executionResult.chainProgress.currentStage}/
                                                {executionResult.chainProgress.totalStages}
                                            </Text>
                                            <Text className="text-sm text-blue-600">
                                                {executionResult.chainProgress.currentNodeLabel}
                                            </Text>
                                        </div>
                                        <Progress
                                            percent={Math.round(
                                                (executionResult.chainProgress.currentStage /
                                                    executionResult.chainProgress.totalStages) *
                                                    100,
                                            )}
                                            size="small"
                                            showInfo={false}
                                            strokeColor="#3b82f6"
                                        />
                                    </div>
                                </div>
                            </div>
                        )}

                    {/* Simple running state (single stage or no progress info) */}
                    {(status === "running" || status === "pending") &&
                        (!executionResult.isChain || !executionResult.chainProgress) && (
                            <div className="px-4 py-3 bg-gray-50">
                                <div className="flex items-center gap-2">
                                    <Spinner size={14} className="animate-spin text-blue-500" />
                                    <Text type="secondary" className="text-sm">
                                        Running...
                                    </Text>
                                </div>
                            </div>
                        )}

                    {/* Chain Results - show all stages with their trace info */}
                    {executionResult.isChain &&
                        executionResult.chainResults &&
                        Object.keys(executionResult.chainResults).length > 0 && (
                            <div className="px-4 py-3 bg-gray-50">
                                <div className="flex items-center justify-between mb-2">
                                    <Text
                                        type="secondary"
                                        className="text-xs uppercase tracking-wide"
                                    >
                                        Chain Results (
                                        {Object.keys(executionResult.chainResults).length} stages)
                                    </Text>
                                    <button
                                        type="button"
                                        onClick={() => setIsChainExpanded(!isChainExpanded)}
                                        className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700 bg-transparent border-none cursor-pointer"
                                    >
                                        {isChainExpanded ? (
                                            <>
                                                <CaretDown size={12} /> Collapse
                                            </>
                                        ) : (
                                            <>
                                                <CaretRight size={12} /> Expand
                                            </>
                                        )}
                                    </button>
                                </div>

                                {/* Always show summary for each stage */}
                                <div className="space-y-2">
                                    {Object.entries(executionResult.chainResults)
                                        .sort(([, a], [, b]) => a.stageIndex - b.stageIndex)
                                        .map(([nodeId, result]) =>
                                            isChainExpanded ? (
                                                <ChainResultItem
                                                    key={nodeId}
                                                    nodeId={nodeId}
                                                    nodeInfo={chainNodes?.find(
                                                        (n) => n.id === nodeId,
                                                    )}
                                                    result={result}
                                                    stageIndex={result.stageIndex}
                                                    totalStages={executionResult.totalStages}
                                                    SharedGenerationResultUtils={
                                                        SharedGenerationResultUtils
                                                    }
                                                />
                                            ) : (
                                                /* Collapsed view - just show stage status summaries */
                                                <div
                                                    key={nodeId}
                                                    className="flex items-center justify-between py-1 px-2 bg-white rounded border border-gray-100"
                                                >
                                                    <div className="flex items-center gap-2">
                                                        {result.nodeType === "evaluatorRevision" ? (
                                                            <Flask
                                                                size={12}
                                                                weight="fill"
                                                                className="text-purple-500"
                                                            />
                                                        ) : (
                                                            <Lightning
                                                                size={12}
                                                                weight="fill"
                                                                className="text-blue-500"
                                                            />
                                                        )}
                                                        <Text className="text-xs">
                                                            Stage {result.stageIndex + 1}:{" "}
                                                            {result.nodeLabel}
                                                        </Text>
                                                        <Tag
                                                            color={getStatusColor(result.status)}
                                                            className="m-0 text-[10px]"
                                                        >
                                                            {result.status}
                                                        </Tag>
                                                    </div>
                                                    {result.traceId && (
                                                        <SharedGenerationResultUtils
                                                            traceId={result.traceId}
                                                            showStatus={false}
                                                        />
                                                    )}
                                                </div>
                                            ),
                                        )}
                                </div>
                            </div>
                        )}

                    {/* Single stage result (non-chain execution) */}
                    {!executionResult.isChain && (status === "success" || status === "error") && (
                        <div className="px-4 py-3 bg-gray-50">
                            <div className="flex items-center justify-between mb-1">
                                <Text type="secondary" className="text-xs uppercase tracking-wide">
                                    Output
                                </Text>
                                {/* Trace utilities for single execution */}
                                {executionResult.chainResults && (
                                    <SharedGenerationResultUtils
                                        traceId={
                                            Object.values(executionResult.chainResults)[0]?.traceId
                                        }
                                    />
                                )}
                            </div>

                            {status === "error" ? (
                                <div className="text-red-600">
                                    <Text strong className="text-red-600">
                                        Error:
                                    </Text>{" "}
                                    {executionResult.error?.message || "Unknown error"}
                                </div>
                            ) : (
                                <div className="max-h-40 overflow-auto">
                                    <SharedEditor
                                        initialValue={outputValue}
                                        editorType="border"
                                        state="readOnly"
                                        disabled
                                        editorProps={{
                                            codeOnly: !!outputLanguage,
                                            language: outputLanguage,
                                            readOnly: true,
                                            showLineNumbers: false,
                                        }}
                                        syncWithInitialValueChanges
                                    />
                                </div>
                            )}
                        </div>
                    )}
                </div>
            )}
        </div>
    )
}

/**
 * TestcasePanel - Right panel for testcase execution
 *
 * This is purely execution context - data source connections
 * are managed in the ConfigPanel.
 */
export function TestcasePanel({
    columns,
    suppliedColumns = [],
    rows,
    executionResults,
    onAddRow,
    onUpdateRow,
    onRemoveRow,
    onClearRows,
    onExecuteRow,
    onExecuteAll,
    isExecuting,
    chainNodes,
}: TestcasePanelProps) {
    // Get injectable components from context
    const {SharedGenerationResultUtils} = usePlaygroundUI()

    // Global toggle state for all rows
    const [globalShowExtras, setGlobalShowExtras] = useState(false)
    // Key that increments when global toggle is clicked (to reset local overrides)
    const [globalToggleKey, setGlobalToggleKey] = useState(0)
    const hasRows = rows.length > 0

    // Check if any results are from chain execution
    const hasChainResults = Object.values(executionResults).some((r) => r.isChain)

    // Compute extra columns (in supplied but not in expected)
    const extraColumns = useMemo(() => {
        const expectedKeys = new Set(columns.map((c) => c.key.toLowerCase()))
        return suppliedColumns.filter((c) => !expectedKeys.has(c.key.toLowerCase()))
    }, [columns, suppliedColumns])

    const hasExtraColumns = extraColumns.length > 0

    // Handler for global toggle - resets all local overrides
    const handleGlobalToggle = useCallback(() => {
        setGlobalShowExtras((prev) => !prev)
        setGlobalToggleKey((prev) => prev + 1)
    }, [])

    return (
        <div className="h-full flex flex-col bg-white">
            {/* Header - Execution controls only */}
            <div className="px-4 py-3 border-b border-gray-200 flex items-center gap-2 bg-white sticky top-0 z-10">
                <Text strong className="text-base">
                    Generations
                </Text>
                {hasChainResults && (
                    <Tag color="blue" className="m-0">
                        Chain
                    </Tag>
                )}
                <div className="flex items-center gap-2 ml-auto">
                    {/* Global toggle for showing all extra variables */}
                    {hasExtraColumns && hasRows && (
                        <Button
                            size="small"
                            type={globalShowExtras ? "primary" : "default"}
                            onClick={handleGlobalToggle}
                            title={
                                globalShowExtras
                                    ? "Collapse all extra data"
                                    : "Expand all extra data"
                            }
                        >
                            {globalShowExtras ? "Collapse all" : "Expand all"}
                        </Button>
                    )}
                    {hasRows && (
                        <Button size="small" onClick={onClearRows}>
                            Clear
                        </Button>
                    )}
                    {onExecuteAll && hasRows && (
                        <Button
                            type="primary"
                            size="small"
                            icon={<Lightning size={14} weight="fill" />}
                            onClick={onExecuteAll}
                            loading={isExecuting}
                            disabled={columns.length === 0}
                        >
                            Run all
                        </Button>
                    )}
                </div>
            </div>

            {/* Testcase List */}
            <div className="flex-1 overflow-y-auto p-4">
                {!hasRows ? (
                    <div className="h-full flex items-center justify-center">
                        <Empty
                            description={
                                <span className="text-gray-500">
                                    No testcases yet.
                                    <br />
                                    Connect a testset or add testcases manually.
                                </span>
                            }
                        >
                            <Button
                                type="primary"
                                icon={<Plus size={14} />}
                                onClick={() => onAddRow()}
                            >
                                Add Testcase
                            </Button>
                        </Empty>
                    </div>
                ) : (
                    <div className="space-y-4">
                        {rows.map((row) => (
                            <TestcaseRow
                                key={row.id}
                                row={row}
                                columns={columns}
                                extraColumns={extraColumns}
                                globalShowExtras={globalShowExtras}
                                globalToggleKey={globalToggleKey}
                                executionResult={executionResults[row.id]}
                                chainNodes={chainNodes}
                                onUpdate={(data) => onUpdateRow(row.id, data)}
                                onRemove={() => onRemoveRow(row.id)}
                                onExecute={() => onExecuteRow(row.id, row.data)}
                                SharedGenerationResultUtils={SharedGenerationResultUtils}
                            />
                        ))}

                        {/* Add Testcase Button */}
                        <Button
                            type="dashed"
                            icon={<Plus size={14} />}
                            onClick={() => onAddRow()}
                            className="w-full"
                        >
                            Testcase
                        </Button>
                    </div>
                )}
            </div>
        </div>
    )
}
