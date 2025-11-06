import {DrawerProps} from "antd"

import {EnhancedObjectConfig} from "@/oss/lib/shared/variant/genericTransformer/types"
import {AgentaConfigPrompt, EnhancedVariant} from "@/oss/lib/shared/variant/transformer/types"

type DrawerType = "variant" | "deployment"
type DrawerVariant = EnhancedVariant<EnhancedObjectConfig<AgentaConfigPrompt>>
interface Revert {
    isDisabled?: boolean
    onClick: () => void
    isLoading: boolean
}

export type ViewType = "prompt" | "parameters"

export interface VariantDrawerProps extends DrawerProps {
    onClose?: (arg: any) => void
    variants?: DrawerVariant[] | null
    variantIds?: string[]
    type: DrawerType
    revert?: Revert
}

export interface VariantDrawerTitleProps {
    variantId: string
    onClose: () => void
    variants: DrawerVariant[]
    isLoading: boolean
    variantIds?: string[]
    viewAs: ViewType
    onToggleWidth: () => void
    isExpanded: boolean
}

export interface VariantDrawerContentProps {
    variantId: string
    isLoading: boolean
    type: DrawerType
    viewAs: ViewType
    onChangeViewAs: (view: ViewType) => void
    // Controls whether to display original saved (stable) values
    showOriginal?: boolean
    onToggleOriginal?: (checked: boolean) => void
}

export interface DeploymentDrawerTitleProps {
    variantId: string
    onClose: () => void
    revert?: Revert
    isLoading: boolean
    onToggleWidth: () => void
    isExpanded: boolean
}
