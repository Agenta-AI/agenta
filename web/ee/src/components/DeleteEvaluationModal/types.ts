import type {ModalProps} from "antd"

export interface DeleteEvaluationModalProps extends ModalProps {
    evaluationType: string
    isMultiple?: boolean
}
