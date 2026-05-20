import type {LlmProvider} from "@agenta/shared/types"
import {DrawerProps, FormInstance, InputProps} from "antd"

export interface ConfigureProviderDrawerProps extends DrawerProps {
    selectedProvider?: LlmProvider | null
}

export interface ModelNameInputProps extends InputProps {
    onDelete: () => void
}
export interface ConfigureProviderDrawerContentProps {
    selectedProvider?: LlmProvider | null
    form: FormInstance<any>
    onClose: () => void
}
