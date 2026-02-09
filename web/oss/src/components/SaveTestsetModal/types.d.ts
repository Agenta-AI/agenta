import {ModalProps} from "antd"

export interface EvaluationRow extends Record<string, any> {}

export interface SaveTestsetModalProps extends ModalProps {
    evaluation: any
    rows: EvaluationRow[]
    onSuccess: (testsetName: string) => void
}
