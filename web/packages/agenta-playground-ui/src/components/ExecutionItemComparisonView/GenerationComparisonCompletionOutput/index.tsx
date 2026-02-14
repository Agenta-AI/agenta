import clsx from "clsx"

import {useExecutionCell} from "../../../hooks/useExecutionCell"
import {useRunnableLoading} from "../../../hooks/useRunnableLoading"
import CompletionMode from "../../ExecutionItems/assets/CompletionMode"
import ExecutionResultView from "../../ExecutionResultView"

interface GenerationComparisonCompletionOutputProps {
    rowId: string
    entityId: string
    variantIndex: number
    isLastRow?: boolean
    isLastVariant?: boolean
}

const GenerationComparisonCompletionOutput = ({
    rowId,
    entityId,
    variantIndex,
    isLastRow,
}: GenerationComparisonCompletionOutputProps) => {
    const isLoading = useRunnableLoading(entityId)
    const {isRunning, currentResult, traceId, repetitionProps} = useExecutionCell({
        entityId: entityId,
        stepId: rowId,
    })

    if (isLoading) {
        return (
            <>
                {variantIndex === 0 ? (
                    <div
                        className={clsx([
                            "border-0 border-b border-solid border-[rgba(5,23,41,0.06)] bg-white sticky left-0 z-[99] !w-[400px]",
                            {"border-r": variantIndex === 0},
                            "shrink-0",
                        ])}
                    >
                        <div className="p-3">
                            <div className="h-12 rounded bg-[rgba(5,23,41,0.06)] animate-pulse" />
                        </div>
                    </div>
                ) : null}
                <div
                    className={clsx([
                        "!min-w-[400px] flex-1 shrink-0 bg-white z-[1]",
                        "border-0 border-r border-b border-solid border-[rgba(5,23,41,0.06)]",
                    ])}
                >
                    <div className="p-3">
                        <div className="h-20 rounded bg-[rgba(5,23,41,0.06)] animate-pulse" />
                    </div>
                </div>
            </>
        )
    }

    return (
        <>
            {variantIndex === 0 ? (
                <div
                    className={clsx([
                        "border-0 border-b border-solid border-[rgba(5,23,41,0.06)] bg-white sticky left-0 z-[99] !w-[400px]",
                        {"border-r": variantIndex === 0},
                        "shrink-0",
                    ])}
                >
                    <div className="w-full flex-1 shrink-0 sticky top-9 z-[2] border-0">
                        <CompletionMode rowId={rowId} withControls={isLastRow} />
                    </div>
                </div>
            ) : null}

            <div
                className={clsx([
                    "!min-w-[400px] flex-1 shrink-0 bg-white z-[1]",
                    "border-0 border-r border-b border-solid border-[rgba(5,23,41,0.06)]",
                ])}
            >
                <div className="!w-full shrink-0 sticky top-9 z-[1]">
                    <ExecutionResultView
                        isRunning={isRunning}
                        currentResult={currentResult}
                        traceId={traceId}
                        repetitionProps={repetitionProps}
                    />
                </div>
            </div>
        </>
    )
}

export default GenerationComparisonCompletionOutput
