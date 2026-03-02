import ComparisonLayout from "./ComparisonLayout"
import {useExecutionRow} from "./hooks/useExecutionRow"
import SingleLayout from "./SingleLayout"

export interface ExecutionRowProps {
    entityId?: string
    rowId: string
    inputOnly?: boolean
    view?: string
    className?: string
    disabled?: boolean
    forceSingle?: boolean
    appType?: string
    index?: number
    /** Render slot for testset drawer button (passed through to SingleLayout) */
    renderTestsetButton?: (props: {
        results: unknown[]
        icon: boolean
        children: React.ReactNode
    }) => React.ReactNode
}

/** @deprecated Alias kept for backward compatibility */
export type GenerationCompletionRowProps = ExecutionRowProps

const ExecutionRow = ({
    entityId,
    rowId,
    inputOnly,
    view,
    disabled,
    forceSingle,
    appType,
    index,
    renderTestsetButton,
}: ExecutionRowProps) => {
    // Skip heavy execution cell data when only rendering variable inputs
    const row = useExecutionRow({entityId, rowId, inputOnly})

    return forceSingle || (row.viewType === "single" && view !== "focus" && entityId) ? (
        <SingleLayout
            rowId={rowId}
            entityId={entityId!}
            isChat={row.isChat}
            isBusy={row.isBusy}
            isRunning={row.isRunning}
            inputOnly={inputOnly}
            result={row.result}
            resultHash={row.resultHash}
            traceId={row.traceId}
            runRow={row.runRow}
            cancelRow={row.cancelRow}
            containerClassName="border-0 border-b border-solid border-colorBorderSecondary"
            appType={appType}
            index={index}
            renderTestsetButton={renderTestsetButton}
        />
    ) : (
        <ComparisonLayout
            rowId={rowId}
            entityId={entityId}
            isChat={row.isChat}
            viewType={row.viewType}
            view={view}
            disabled={disabled}
            inputOnly={inputOnly}
            resultHash={row.resultHash}
            runRow={row.runRow}
            cancelRow={row.cancelRow}
            isBusy={row.isBusy}
            appType={appType}
        />
    )
}

export default ExecutionRow
