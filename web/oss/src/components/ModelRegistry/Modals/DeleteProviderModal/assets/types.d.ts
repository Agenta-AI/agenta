import {LlmProvider} from "@/oss/lib/helpers/llmProviders"
import {ModalProps} from "antd"

export interface DeleteProviderModalProps extends ModalProps {
    selectedProvider: LlmProvider | null
}

export interface DeleteProviderModalContentProps {
    selectedProvider: LlmProvider | null
}
