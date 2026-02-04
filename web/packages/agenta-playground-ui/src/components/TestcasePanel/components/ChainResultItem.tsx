/**
 * ChainResultItem Component
 *
 * Displays a single stage result from a chain execution, including:
 * - Stage info (number, label, type icon)
 * - Status tag
 * - Trace utilities (latency, tokens, cost)
 * - Output content or error message
 */

import {useMemo} from "react"

import type {StageExecutionResult} from "@agenta/entities/runnable"
import {detectEditorLanguage} from "@agenta/shared/utils"
import {SharedEditor} from "@agenta/ui/shared-editor"
import {cn, entityIconColors, statusColors, bgColors} from "@agenta/ui/styles"
import {Flask, Lightning, Spinner} from "@phosphor-icons/react"
import {Tag, Typography} from "antd"

import type {ChainNodeInfo} from "../../types"

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

export interface ChainResultItemProps {
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
}

/**
 * Chain result item showing a downstream node's output with trace info
 */
export function ChainResultItem({
    nodeId,
    nodeInfo,
    result,
    stageIndex,
    totalStages,
    SharedGenerationResultUtils,
}: ChainResultItemProps) {
    const isEvaluator = nodeInfo?.type === "evaluatorRevision"
    const label = nodeInfo?.label || result.nodeLabel || nodeId
    const outputLanguage = useMemo(() => getOutputLanguage(result.output), [result.output])
    const outputValue = useMemo(() => formatOutput(result.output), [result.output])
    const showStageNumber = stageIndex !== undefined && totalStages !== undefined && totalStages > 1

    return (
        <div className={cn("rounded p-3 border", bgColors.subtle, "border-zinc-2")}>
            {/* Header with stage info and status */}
            <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                    {isEvaluator ? (
                        <Flask size={14} weight="fill" className="text-purple-6" />
                    ) : (
                        <Lightning size={14} weight="fill" className={entityIconColors.primary} />
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
                <div className={cn("flex items-center gap-2", entityIconColors.primary)}>
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
                <div
                    className={cn("mt-1 p-2 rounded border", statusColors.errorBg, "border-red-2")}
                >
                    <Text type="danger" className="text-xs">
                        {result.error.message}
                    </Text>
                </div>
            )}
        </div>
    )
}

// Export helper functions for reuse
export {getStatusColor, formatOutput, getOutputLanguage}
