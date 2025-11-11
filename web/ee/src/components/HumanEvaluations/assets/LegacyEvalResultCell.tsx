import {memo} from "react"
import {Tag, Typography, Space} from "antd"
import EvaluationErrorPopover from "../../pages/evaluations/EvaluationErrorProps/EvaluationErrorPopover"
import {getTypedValue} from "@/oss/lib/helpers/evaluate"

export const LegacyEvalResultCell = memo(({matchingResults}: {matchingResults: any}) => {
    return (
        <Space>
            {matchingResults?.map((result, index) =>
                result?.result?.error ? (
                    <EvaluationErrorPopover result={result?.result} key={index} />
                ) : (
                    <Typography key={index}>{getTypedValue(result?.result)}</Typography>
                ),
            )}
        </Space>
    )
})

export const LegacyEvalResultCellTitle = memo(({evaluator}: {evaluator: any}) => {
    return (
        <div className="w-full flex items-center justify-between">
            <span className="whitespace-nowrap">{evaluator?.name}</span>
            <Tag className="ml-2" color={evaluator?.evaluator?.color}>
                {evaluator?.evaluator?.name}
            </Tag>
        </div>
    )
})
