import type {LlmProvider} from "@agenta/shared/types"
import {DrawerProps, FormInstance, InputProps} from "antd"

export interface ConfigureProviderDrawerProps extends DrawerProps {
    selectedProvider?: LlmProvider | null
    /** Pre-selects the provider kind for a NEW provider (e.g. from a rail "Add Bedrock" row). */
    initialProviderKind?: string
}

// Kept for CreateNewMetric (AnnotateDrawer), which reuses this generic input+delete control.
export interface ModelNameInputProps extends InputProps {
    onDelete: () => void
}

export interface ConfigureProviderDrawerContentProps {
    selectedProvider?: LlmProvider | null
    initialProviderKind?: string
    form: FormInstance<LlmProvider>
    onClose: () => void
}
