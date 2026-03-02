/**
 * TestcaseRow Component
 *
 * Single testcase row with:
 * - Input fields for variables
 * - Extra data section (collapsible)
 * - Run button
 * - Output display (single execution or chain results)
 * - State indicators (ready, stale, override)
 */

import {useCallback, useMemo, useState} from "react"

import {loadableController} from "@agenta/entities/loadable"
import type {TestsetColumn, TestsetRow as TestsetRowType} from "@agenta/entities/runnable"
import {detectEditorLanguage} from "@agenta/shared/utils"
import {SharedEditor} from "@agenta/ui/shared-editor"
import {
    cn,
    entityIconColors,
    statusColors,
    textColors,
    bgColors,
    borderColors,
    interactiveStyles,
} from "@agenta/ui/styles"
import {
    ArrowCounterClockwise,
    ArrowsClockwise,
    CaretDown,
    CaretRight,
    Flask,
    Lightning,
    Spinner,
    Trash,
    Warning,
} from "@phosphor-icons/react"
import {Button, Input, Progress, Tag, Tooltip, Typography} from "antd"
import {useAtomValue} from "jotai"

import type {ChainExecutionResult, ChainNodeInfo} from "../../types"

import {ChainResultItem, getStatusColor} from "./ChainResultItem"

const {Text} = Typography

/**
 * Get editor language for output content.
 */
function getOutputLanguage(output: unknown): "json" | "yaml" | "code" | undefined {
    const detected = detectEditorLanguage(output)
    if (detected === "text" || detected === "markdown") {
        return undefined
    }
    return detected
}

/**
 * Format output value for display
 */
function formatOutput(output: unknown): string {
    if (typeof output === "string") return output
    if (output === null || output === undefined) return "—"
    return JSON.stringify(output, null, 2)
}

export interface TestcaseRowProps {
    loadableId: string
    row: TestsetRowType
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
    /** Revert output mapping overrides for this row */
    onRevertOverrides?: () => void
    SharedGenerationResultUtils: React.ComponentType<{
        traceId?: string | null
        showStatus?: boolean
        className?: string
    }>
}

/**
 * Single testcase row with input fields, run button, and output display
 */
export function TestcaseRow({
    loadableId,
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
    onRevertOverrides,
    SharedGenerationResultUtils,
}: TestcaseRowProps) {
    const [isChainExpanded, setIsChainExpanded] = useState(false)
    // Local override for this row (null = follow global)
    // Reset when global toggle changes by using globalToggleKey in the key
    const [localShowExtras, setLocalShowExtras] = useState<boolean | null>(null)

    // Row state indicators from controller selectors
    const rowReadyStateAtom = useMemo(
        () => loadableController.selectors.rowReadyState(loadableId, row.id),
        [loadableId, row.id],
    )
    const rowStaleStateAtom = useMemo(
        () => loadableController.selectors.rowExecutionStaleState(loadableId, row.id),
        [loadableId, row.id],
    )
    const rowOverrideStateAtom = useMemo(
        () => loadableController.selectors.rowOutputMappingOverrideState(loadableId, row.id),
        [loadableId, row.id],
    )
    const rowReadyState = useAtomValue(rowReadyStateAtom)
    const rowStaleState = useAtomValue(rowStaleStateAtom)
    const rowOverrideState = useAtomValue(rowOverrideStateAtom)

    // Effective value: local override takes precedence over global
    const showExtras = localShowExtras ?? globalShowExtras
    const hasExtras = extraColumns.length > 0

    const status = executionResult?.status || "idle"
    const isRunning = status === "running" || status === "pending"
    const hasExecutionResult = executionResult && status !== "idle"

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
        <div
            className={cn(
                "border rounded-lg overflow-hidden",
                borderColors.secondary,
                bgColors.container,
            )}
        >
            {/* Input Fields */}
            <div className="p-4 space-y-3">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <Text type="secondary" className="text-xs uppercase tracking-wide">
                            Variables
                        </Text>
                        {/* Row state indicators */}
                        {!rowReadyState.isReady && (
                            <Tooltip title={`Missing: ${rowReadyState.missingKeys.join(", ")}`}>
                                <Warning size={14} className={statusColors.warning} />
                            </Tooltip>
                        )}
                        {hasExecutionResult && rowStaleState?.isStale && (
                            <Tooltip
                                title={`Inputs changed since last run: ${rowStaleState.changedKeys.join(", ")}`}
                            >
                                <ArrowsClockwise size={14} className={entityIconColors.primary} />
                            </Tooltip>
                        )}
                        {/* Output mapping override indicator with revert action */}
                        {/* Only show when there are overrides AND output mapping is not disabled */}
                        {rowOverrideState?.hasOverrides &&
                            !rowOverrideState.isDisabled &&
                            onRevertOverrides && (
                                <Tooltip
                                    title={`Auto-mapped values overwrote: ${rowOverrideState.overriddenColumns.join(", ")}. Click to revert.`}
                                >
                                    <Button
                                        type="text"
                                        size="small"
                                        icon={<ArrowCounterClockwise size={14} />}
                                        onClick={onRevertOverrides}
                                        className="text-purple-6 hover:text-purple-7 p-0 h-auto"
                                    />
                                </Tooltip>
                            )}
                    </div>
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
                            <Text className={cn("text-sm font-medium", entityIconColors.primary)}>
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
                    ))
                )}

                {/* Extra Variables - shown when toggle is on */}
                {showExtras && extraColumns.length > 0 && (
                    <div className={cn("pt-2 border-t space-y-2", borderColors.divider)}>
                        <Text type="secondary" className="text-xs uppercase tracking-wide">
                            Other Data
                        </Text>
                        {extraColumns.map((col) => (
                            <div key={col.key} className="space-y-1">
                                <Text className={cn("text-sm font-medium", textColors.secondary)}>
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
            <div className={cn("px-4 py-2 border-t", bgColors.subtle, borderColors.strong)}>
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
                <div className={cn("border-t", borderColors.secondary)}>
                    {/* Chain Progress Header (when running multi-stage) */}
                    {(status === "running" || status === "pending") &&
                        executionResult.isChain &&
                        executionResult.chainProgress && (
                            <div className="px-4 py-3 bg-blue-1 border-b border-blue-2">
                                <div className="flex items-center gap-3">
                                    <Spinner
                                        size={16}
                                        className={cn("animate-spin", entityIconColors.primary)}
                                    />
                                    <div className="flex-1">
                                        <div className="flex items-center gap-2 mb-1">
                                            <Text strong className="text-sm text-blue-7">
                                                Running Stage{" "}
                                                {executionResult.chainProgress.currentStage}/
                                                {executionResult.chainProgress.totalStages}
                                            </Text>
                                            <Text
                                                className={cn("text-sm", entityIconColors.primary)}
                                            >
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
                            <div className={cn("px-4 py-3", bgColors.subtle)}>
                                <div className="flex items-center gap-2">
                                    <Spinner
                                        size={14}
                                        className={cn("animate-spin", entityIconColors.primary)}
                                    />
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
                            <div className={cn("px-4 py-3", bgColors.subtle)}>
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
                                        className={cn(
                                            "flex items-center gap-1 text-xs bg-transparent border-none cursor-pointer",
                                            interactiveStyles.clickableText,
                                        )}
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
                                                    className={cn(
                                                        "flex items-center justify-between py-1 px-2 rounded border",
                                                        bgColors.container,
                                                        borderColors.divider,
                                                    )}
                                                >
                                                    <div className="flex items-center gap-2">
                                                        {result.nodeType === "evaluatorRevision" ? (
                                                            <Flask
                                                                size={12}
                                                                weight="fill"
                                                                className="text-purple-6"
                                                            />
                                                        ) : (
                                                            <Lightning
                                                                size={12}
                                                                weight="fill"
                                                                className={entityIconColors.primary}
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
                        <div className={cn("px-4 py-3", bgColors.subtle)}>
                            <div className="flex items-center justify-between mb-1">
                                <Text type="secondary" className="text-xs uppercase tracking-wide">
                                    Output
                                </Text>
                                {/* Trace utilities for single execution - use top-level traceId */}
                                {executionResult.traceId && (
                                    <SharedGenerationResultUtils
                                        traceId={executionResult.traceId}
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
