import {ModalProps} from "antd"

export interface DeleteVariantModalProps extends ModalProps {
    revisionIds: string[]
}
