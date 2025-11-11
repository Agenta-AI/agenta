import {memo} from "react"
import EvalRunScoreTableSkeleton from "../../EvalRunScoreTable/assets/EvalRunScoreTableSkeleton"
import EvaluatorMetricsChartSkeleton from "../../EvaluatorMetricsChart/assets/EvaluatorMetricsChartSkeleton"

const EvalRunOverviewViewerSkeleton = () => {
    return (
        <>
            <div className="px-6 w-full h-full">
                <EvalRunScoreTableSkeleton />
            </div>

            <div className="px-6 w-full flex flex-wrap gap-2">
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
