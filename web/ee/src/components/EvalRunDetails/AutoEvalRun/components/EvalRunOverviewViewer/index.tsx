import {memo} from "react"
import EvalRunScoreTable from "../EvalRunScoreTable"
import EvaluatorMetricsChart from "../EvaluatorMetricsChart"
import {useAtomValue} from "jotai"
import {runMetricsStatsAtom} from "@/oss/lib/hooks/useEvaluationRunData/assets/atoms/runMetricsCache"
import {formatMetricName} from "../../assets/utils"
import {
    evaluationEvaluatorsAtom,
    loadingStateAtom,
} from "@/oss/lib/hooks/useEvaluationRunData/assets/atoms"
import EvalRunOverviewViewerSkeleton from "./assets/EvalRunOverviewViewerSkeleton"

const EvalRunOverviewViewer = () => {
    const metrics = useAtomValue(runMetricsStatsAtom)
    const evaluators = useAtomValue(evaluationEvaluatorsAtom)
    const loadingState = useAtomValue(loadingStateAtom)

    if (loadingState.isLoadingMetrics) {
        return <EvalRunOverviewViewerSkeleton />
    }
    return (
        <>
            <div className="px-6 w-full h-full">
                <EvalRunScoreTable className="w-[100%] h-full" />
            </div>

            <div className="px-6 w-full flex flex-wrap gap-2">
                {Object.entries(metrics || {}).map(([name, metric], idx) => {
                    if (!name.includes(".")) return null
                    if (!metric || !Object.keys(metric || {}).length) return null
                    const [evaluatorSlug, metricKey] = name.split(".")
                    return (
                        <EvaluatorMetricsChart
                            key={`${metricKey}-${idx}`}
                            className="w-[calc(50%-0.3rem)] 2xl:w-[calc(33.33%-0.34rem)]"
                            name={formatMetricName(metricKey)}
                            metric={metric}
                            evaluator={evaluators?.find((e) => e.slug === evaluatorSlug)}
                        />
                    )
                })}
            </div>
        </>
    )
}

export default memo(EvalRunOverviewViewer)
