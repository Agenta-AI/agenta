import type {LlmProvider} from "@agenta/shared/types"
import {ModalProps} from "antd"

export interface DeleteProviderModalProps extends ModalProps {
    selectedProvider: LlmProvider | null
}

export interface DeleteProviderModalContentProps {
    selectedProvider: LlmProvider | null
}
