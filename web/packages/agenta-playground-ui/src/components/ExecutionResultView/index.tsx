import {useMemo} from "react"

import {playgroundController} from "@agenta/playground"
import {deriveToolViewModelFromResult} from "@agenta/shared/utils"
import {SharedEditor} from "@agenta/ui/shared-editor"
import {Typography} from "antd"
import {useAtomValue} from "jotai"

import {usePlaygroundUIOptional} from "../../context/PlaygroundUIContext"
import RepetitionNavigation from "../ExecutionItems/assets/RepetitionNavigation"
import {ClickRunPlaceholder} from "../ExecutionItems/assets/ResultPlaceholder"
import TypingIndicator from "../ExecutionItems/assets/TypingIndicator"
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
            className="w-full"
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
}) {
    const {toolData, isJSON, displayValue} = useMemo(
        () => deriveToolViewModelFromResult(result),
        [result],
    )

    if (toolData) {
        return <ToolCallView resultData={toolData} className="w-full" footer={footer} />
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
                className="w-full"
                editorClassName="min-h-4 [&_p:first-child]:!mt-0"
                footer={footer}
                handleChange={() => undefined}
            />
        </div>
    )
}
