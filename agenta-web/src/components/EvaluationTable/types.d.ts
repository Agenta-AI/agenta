import {EvaluationFlow} from "@/lib/enums"
import {createUseStyles} from "react-jss"
import {Evaluation, EvaluationScenario} from "@/lib/Types"

export interface EvaluationTableProps {
    evaluation: Evaluation
    evaluationScenarios: SingleModelEvaluationRow[]
    isLoading: boolean
}

export type SingleModelEvaluationRow = EvaluationScenario & {
    evaluationFlow: EvaluationFlow
} & {[variantId: string]: string}

export interface ABTestingEvaluationTableProps extends EvaluationTableProps {
    evaluationScenarios: ABTestingEvaluationTableRow[]
    columnsCount: number
}

export type ABTestingEvaluationTableRow = EvaluationScenario & {
    evaluationFlow: EvaluationFlow
} & {[variantId: string]: string}
