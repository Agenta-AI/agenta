import {EnhancedObjectConfig} from "@/oss/lib/shared/variant/genericTransformer/types"
import {AgentaConfigPrompt, EnhancedVariant} from "@/oss/lib/shared/variant/transformer/types"
import {Variant, Environment} from "@/oss/lib/Types"
import {Drawer, DrawerProps} from "antd"

type DrawerType = "variant" | "deployment"
type DrawerVariant = EnhancedVariant<EnhancedObjectConfig<AgentaConfigPrompt>>
type Revert = {
    isDisabled?: boolean
    onClick: () => void
    isLoading: boolean
}

export interface VariantDrawerProps extends DrawerProps {
    onClose?: (arg: any) => void
    variants: DrawerVariant[]
    type: DrawerType
    revert?: Revert
}

export interface VariantDrawerTitleProps {
    selectedVariant: DrawerVariant
    onClose: () => void
    variants: DrawerVariant[]
    isDirty: boolean
}

export interface VariantDrawerContentProps {
    selectedVariant: DrawerVariant
    promptIds: string[]
    isLoading: boolean
    variants: DrawerVariant[]
    type: DrawerType
}

export interface DeploymentDrawerTitleProps {
    selectedVariant: DrawerVariant
    onClose: () => void
    revert?: Revert
}
