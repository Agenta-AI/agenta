import type {ReactNode} from "react"

import {deriveToolViewModelFromResult} from "@agenta/shared/utils"
import {SharedEditor} from "@agenta/ui/shared-editor"

import ToolCallView from "../shared/ToolCallView"

import {RepeatNav, type RepeatNavProps} from "./RepeatNav"
import {RunError, type RunErrorResult} from "./RunError"
import {RunningIndicator} from "./RunningIndicator"

export interface RunResultProps {
    isRunning: boolean
    /** The repeat on screen, or null before the first run. */
    result: (RunErrorResult & Record<string, unknown>) | null
    traceId: string | null
    /** Set when the run has more than one repeat. */
    repeats?: RepeatNavProps
    /** The line under the output with the run's numbers and the trace link. */
    renderTraceFooter?: (traceId: string) => ReactNode
}

/**
 * What one run produced: a hint before the first run, a spinner while it runs, then the output
 * (text, JSON or a tool call) or the error, with the trace footer under it.
 */
export const RunResult = ({
    isRunning,
    result,
    traceId,
    repeats,
    renderTraceFooter,
}: RunResultProps) => {
    if (!result) {
        return isRunning ? (
            <RunningIndicator />
        ) : (
            <p className="m-0 px-1 py-2 text-sm text-muted-foreground">
                Click run (Ctrl+Enter / ⌘+Enter) to generate output
            </p>
        )
    }

    const footer = traceId && renderTraceFooter ? renderTraceFooter(traceId) : null
    return (
        <div className="flex min-w-0 flex-col gap-2">
            {isRunning ? <RunningIndicator label="Re-running..." /> : null}
            {result.error ? (
                <RunError result={result} />
            ) : (
                <Output result={result} repeats={repeats} footer={footer} />
            )}
            {result.error && footer ? <div>{footer}</div> : null}
        </div>
    )
}

const Output = ({
    result,
    repeats,
    footer,
}: {
    result: unknown
    repeats?: RepeatNavProps
    footer: ReactNode
}) => {
    const {toolData, isJSON, displayValue} = deriveToolViewModelFromResult(result)
    return (
        <div className="min-w-0">
            {repeats ? <RepeatNav {...repeats} /> : null}
            {toolData ? (
                <ToolCallView resultData={toolData} className="w-full" footer={footer} />
            ) : (
                <>
                    <SharedEditor
                        initialValue={displayValue}
                        editorType="borderless"
                        state="filled"
                        readOnly
                        disabled
                        editorProps={{codeOnly: isJSON}}
                        className="w-full !border-none !p-0 [&_.agenta-rich-text-editor]:!min-h-0"
                        editorClassName="min-h-4 [&_p:first-child]:!mt-0"
                        handleChange={() => undefined}
                    />
                    {footer}
                </>
            )}
        </div>
    )
}
