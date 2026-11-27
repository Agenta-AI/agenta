import type {EnhancedButtonProps as ButtonProps} from "@/oss/components/LegacyKit"

export interface DeployVariantButtonProps extends ButtonProps {
    variantId?: string
    revisionId?: string
    label?: React.ReactNode
    icon?: boolean
    children?: React.ReactNode
}
