import {ModalProps} from "antd"
import {Evaluation, EvaluationFlow, EvaluationScenario} from "@/oss/lib/Types"

export interface EvaluationRow extends EvaluationScenario, Record<string, string> {
    evaluationFlow: EvaluationFlow
}

export interface SaveTestsetModalProps extends ModalProps {
    evaluation: Evaluation
    rows: EvaluationRow[]
    onSuccess: (testsetName: string) => void
}
