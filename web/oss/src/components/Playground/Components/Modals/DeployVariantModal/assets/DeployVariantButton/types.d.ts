import type {EnhancedButtonProps as ButtonProps} from "@agenta/ui/components/presentational"

export interface DeployVariantButtonProps extends ButtonProps {
    variantId?: string
    revisionId?: string
    label?: React.ReactNode
    icon?: boolean
    children?: React.ReactNode
}
