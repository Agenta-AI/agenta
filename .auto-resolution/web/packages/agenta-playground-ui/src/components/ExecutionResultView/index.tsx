import {useMemo} from "react"

import type {RunnablePort} from "@agenta/entities/runnable"
import {playgroundController} from "@agenta/playground"
import {deriveToolViewModelFromResult} from "@agenta/shared/utils"
import {SharedEditor} from "@agenta/ui/shared-editor"
import {Typography} from "antd"
import {useAtomValue} from "jotai"

import {usePlaygroundUIOptional} from "../../context/PlaygroundUIContext"
import RepetitionNavigation from "../ExecutionItems/assets/RepetitionNavigation"
import {ClickRunPlaceholder} from "../ExecutionItems/assets/ResultPlaceholder"
import TypingIndicator from "../ExecutionItems/assets/TypingIndicator"
import {EvaluatorFieldGrid} from "../shared/EvaluatorFieldGrid"
import {extractDisplayEntries} from "../shared/EvaluatorFieldGrid/utils"
import ToolCallView from "../ToolCallView"

interface ExecutionResultViewProps {
    isRunning: boolean
    currentResult: {
        error?: string | unknown
        response?: unknown
        metadata?: {
            rawError?: {detail?: string}
            retryAfter?: number
        }
    } | null
    traceId: string | null
    repetitionProps?: {
        current: number
        total: number
        onNext: () => void
        onPrev: () => void
    }
    showEmptyPlaceholder?: boolean
    /** Output ports for evaluator-style result rendering (score/reasoning grid) */
    outputPorts?: RunnablePort[]
    /** Feedback configuration for enriching evaluator score rendering with range context */
    feedbackConfig?: Record<string, unknown> | null
}

/**
 * Unified execution result renderer for completion mode.
 *
 * Replaces the ErrorPanel + GenerationResponsePanel branching pattern.
 * Handles all result states: running, error, response (text/tool/json), and empty.
 *
 * Used in both single and comparison views.
 */
export default function ExecutionResultView({
    isRunning,
    currentResult,
    traceId,
    repetitionProps,
    showEmptyPlaceholder = true,
    outputPorts,
    feedbackConfig,
}: ExecutionResultViewProps) {
    const providers = usePlaygroundUIOptional()
    const SharedGenerationResultUtils = providers?.SharedGenerationResultUtils

    const isComparisonView = useAtomValue(
        useMemo(() => playgroundController.selectors.isComparisonView(), []),
    )
    const isRerunning = isRunning && Boolean(currentResult)

    if (isRunning && !currentResult) {
        return <TypingIndicator />
    }

    if (!currentResult) {
        // Evaluator-style nodes with known output ports: show field labels with dashes
        if (outputPorts && outputPorts.length > 0) {
            return <EvaluatorFieldGrid entries={null} outputPorts={outputPorts} idle />
        }
        if (!showEmptyPlaceholder) return null
        return <ClickRunPlaceholder />
    }

    const traceFooter =
        traceId && SharedGenerationResultUtils ? (
            <div className="w-full flex items-center justify-start mt-2 gap-2 flex-nowrap overflow-hidden">
                <SharedGenerationResultUtils traceId={traceId} />
            </div>
        ) : null

    // Error state
    if (currentResult.error) {
        return (
            <div className="flex flex-col gap-2">
                {isRerunning ? <TypingIndicator label="Re-running..." size="small" /> : null}
                <ErrorContent result={currentResult} footer={traceFooter} />
            </div>
        )
    }

    // Success state
    return (
        <div className="flex flex-col gap-2">
            {isRerunning ? <TypingIndicator label="Re-running..." size="small" /> : null}
            <ResponseContent
                result={currentResult}
                footer={traceFooter}
                repetitionProps={repetitionProps}
                isComparisonView={isComparisonView}
                outputPorts={outputPorts}
                feedbackConfig={feedbackConfig}
            />
        </div>
    )
}

// ---------------------------------------------------------------------------
// Internal sub-components
// ---------------------------------------------------------------------------

function ErrorContent({
    result,
    footer,
}: {
    result: {
        error?: string | unknown
        metadata?: {rawError?: {detail?: string}; retryAfter?: number}
    }
    footer: React.ReactNode
}) {
    let errorText =
        typeof result?.error === "string" ? result.error : String(result?.error ?? "Error")

    if (
        errorText === "An unknown error occurred" ||
        errorText === "Unknown error" ||
        errorText === "Error"
    ) {
        const detail =
            typeof result?.metadata?.rawError?.detail === "string"
                ? result.metadata.rawError.detail
                : undefined
        if (detail) {
            errorText = detail
        }
        const retryAfter = result?.metadata?.retryAfter
        if (retryAfter) {
            errorText = `${errorText} Retry after ${retryAfter}s.`
        }
    }

    return (
        <SharedEditor
            initialValue={errorText}
            editorType="borderless"
            state="filled"
            readOnly
            disabled
            error
            className="w-full !border-none !p-0 [&_.agenta-rich-text-editor]:!min-h-0"
            editorClassName="min-h-4 [&_p:first-child]:!mt-0"
            footer={footer}
            handleChange={() => undefined}
        />
    )
}

function ResponseContent({
    result,
    footer,
    repetitionProps,
    isComparisonView,
    outputPorts,
    feedbackConfig,
}: {
    result: unknown
    footer: React.ReactNode
    repetitionProps?: {
        current: number
        total: number
        onNext: () => void
        onPrev: () => void
    }
    isComparisonView: boolean
    outputPorts?: RunnablePort[]
    feedbackConfig?: Record<string, unknown> | null
}) {
    const {toolData, isJSON, displayValue} = useMemo(
        () => deriveToolViewModelFromResult(result),
        [result],
    )

    // Detect evaluator-style structured output (score/reasoning) when the
    // standard text extraction produces nothing meaningful.
    const evaluatorEntries = useMemo(() => {
        if (toolData || displayValue) return null
        return extractDisplayEntries(result as Record<string, unknown>)
    }, [toolData, displayValue, result])

    if (toolData) {
        return <ToolCallView resultData={toolData} className="w-full" footer={footer} />
    }

    // Evaluator-style output: render via EvaluatorFieldGrid
    if (evaluatorEntries) {
        return (
            <div>
                {repetitionProps && !isComparisonView && (
                    <div className="flex gap-1 items-center mb-1">
                        <Typography.Text type="secondary" className="text-[10px] text-nowrap">
                            Total repeats
                        </Typography.Text>
                        <RepetitionNavigation {...repetitionProps} />
                    </div>
                )}
                <EvaluatorFieldGrid
                    entries={evaluatorEntries}
                    outputPorts={outputPorts ?? []}
                    feedbackConfig={feedbackConfig}
                    className="py-2"
                />
                {footer}
            </div>
        )
    }

    return (
        <div>
            {repetitionProps && !isComparisonView && (
                <div className="flex gap-1 items-center mb-1">
                    <Typography.Text type="secondary" className="text-[10px] text-nowrap">
                        Total repeats
                    </Typography.Text>
                    <RepetitionNavigation {...repetitionProps} />
                </div>
            )}

            <SharedEditor
                initialValue={displayValue}
                editorType="borderless"
                state="filled"
                readOnly
                editorProps={{codeOnly: isJSON}}
                disabled
                className="w-full !border-none !p-0 [&_.agenta-rich-text-editor]:!min-h-0"
                editorClassName="min-h-4 [&_p:first-child]:!mt-0"
                footer={footer}
                handleChange={() => undefined}
            />
        </div>
    )
}
