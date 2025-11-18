import {memo} from "react"

import EvalRunScoreTableSkeleton from "../../../AutoEvalRun/components/EvalRunScoreTable/assets/EvalRunScoreTableSkeleton"
import EvaluatorMetricsChartSkeleton from "../../../AutoEvalRun/components/EvaluatorMetricsChart/assets/EvaluatorMetricsChartSkeleton"
import clsx from "clsx"

const EvalRunOverviewViewerSkeleton = ({className}: {className?: string}) => {
    return (
        <>
            <div className={clsx("px-6 w-full h-full", className)}>
                <EvalRunScoreTableSkeleton />
            </div>

            <div className={clsx("w-full flex flex-wrap gap-2", className)}>
                {Array.from({length: 3}).map((_, index) => (
                    <EvaluatorMetricsChartSkeleton
                        key={index}
                        className="w-[calc(50%-0.3rem)] xl:w-[calc(33.33%-0.34rem)] 2xl:w-[calc(25%-0.39rem)]"
                    />
                ))}
            </div>
        </>
    )
}

export default memo(EvalRunOverviewViewerSkeleton)
