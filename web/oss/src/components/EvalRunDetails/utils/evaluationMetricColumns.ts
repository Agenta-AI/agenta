import type {MetricColumnDefinition} from "@agenta/entities/workflow"

import type {EvaluationRunKind} from "@/oss/lib/evaluations/utils/evaluationKind"

interface StaticMetricColumns {
    auto: MetricColumnDefinition[]
    human: MetricColumnDefinition[]
}

export const usesHumanMetricColumns = (evaluationType: EvaluationRunKind) =>
    evaluationType === "human"

export const usesAutoMetricColumns = (evaluationType: EvaluationRunKind) =>
    !usesHumanMetricColumns(evaluationType)

export const selectStaticMetricColumnsForEvaluationType = (
    staticMetricColumns: StaticMetricColumns,
    evaluationType: EvaluationRunKind,
) => (usesHumanMetricColumns(evaluationType) ? staticMetricColumns.human : staticMetricColumns.auto)
