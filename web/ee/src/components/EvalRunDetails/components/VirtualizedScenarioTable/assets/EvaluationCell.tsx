import {memo} from "react"
import {CellWrapper} from "./CellComponents"
import {Tag} from "antd"

const EvaluationCell = ({evaluationRunName}: {evaluationRunName: string}) => {
    return (
        <CellWrapper className="gap-2">
            <Tag>{evaluationRunName}</Tag>
        </CellWrapper>
    )
}

export default memo(EvaluationCell)
