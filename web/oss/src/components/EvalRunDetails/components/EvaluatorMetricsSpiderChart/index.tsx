import dynamic from "next/dynamic"

import type {EvaluatorMetricsSpiderChartProps} from "./types"

const EvaluatorMetricsSpiderChart = dynamic<EvaluatorMetricsSpiderChartProps>(
    () => import("./EvaluatorMetricsSpiderChart"),
    {ssr: false},
)

export type {EvaluatorMetricsSpiderChartProps}
export default EvaluatorMetricsSpiderChart
