import type {LlmProvider} from "@agenta/shared/types"
import {InputProps, ModalProps} from "antd"

export interface ConfigureProviderModalProps extends ModalProps {
    selectedProvider: LlmProvider | null
}

export interface ConfigureProviderModalContentProps extends InputProps {
    selectedProvider: LlmProvider | null
}
