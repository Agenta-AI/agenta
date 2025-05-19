import {ModalProps} from "antd"

import {LlmProvider} from "@/oss/lib/helpers/llmProviders"

export interface DeleteProviderModalProps extends ModalProps {
    selectedProvider: LlmProvider | null
}

export interface DeleteProviderModalContentProps {
    selectedProvider: LlmProvider | null
}
