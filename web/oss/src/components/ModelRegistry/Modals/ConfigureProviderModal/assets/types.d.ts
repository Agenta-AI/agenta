import {InputProps, ModalProps} from "antd"

import {LlmProvider} from "@/oss/lib/helpers/llmProviders"

export interface ConfigureProviderModalProps extends ModalProps {
    selectedProvider: LlmProvider | null
}

export interface ConfigureProviderModalContentProps extends InputProps {
    selectedProvider: LlmProvider | null
}
