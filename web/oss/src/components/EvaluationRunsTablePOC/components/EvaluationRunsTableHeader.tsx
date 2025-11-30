import {Typography} from "antd"

import EvaluationRunsCreateButton from "./EvaluationRunsCreateButton"
import EvaluationRunsDeleteButton from "./EvaluationRunsDeleteButton"
import EvaluationRunsHeaderFilters from "./filters/EvaluationRunsHeaderFilters"

interface EvaluationRunsTableHeaderProps {
    showFilters?: boolean
    title?: React.ReactNode
}

const EvaluationRunsTableHeader = ({showFilters = true, title}: EvaluationRunsTableHeaderProps) => (
    <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex-1 min-w-[200px]">
            {showFilters ? (
                <EvaluationRunsHeaderFilters />
            ) : title ? (
                <Typography.Title level={5} style={{margin: 0}}>
                    {title}
                </Typography.Title>
            ) : null}
        </div>

        <div className="flex flex-wrap gap-2">
            <EvaluationRunsDeleteButton />
            <EvaluationRunsCreateButton />
        </div>
    </div>
)

export default EvaluationRunsTableHeader
