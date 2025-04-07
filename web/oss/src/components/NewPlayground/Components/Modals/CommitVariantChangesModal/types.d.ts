import {ModalProps} from "antd"

export interface CommitVariantChangesModalProps extends ModalProps {
    variantId: string
}

export interface SelectedCommitType {
    type: "version" | "variant" | null
    name?: string
}
