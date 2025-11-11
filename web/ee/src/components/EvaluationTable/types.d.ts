import {EvaluationFlow} from "@/oss/lib/enums"
import {Evaluation, EvaluationScenario} from "@/oss/lib/Types"

export interface EvaluationTableProps {
    evaluation: Evaluation
    evaluationScenarios: SingleModelEvaluationRow[]
    isLoading: boolean
}

export type SingleModelEvaluationRow = EvaluationScenario & {
    evaluationFlow: EvaluationFlow
} & Record<string, string>

export interface ABTestingEvaluationTableProps extends EvaluationTableProps {
    evaluationScenarios: ABTestingEvaluationTableRow[]
    columnsCount: number
}

export type ABTestingEvaluationTableRow = EvaluationScenario & {
    evaluationFlow: EvaluationFlow
} & Record<string, string>
