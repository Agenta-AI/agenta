import type {Workflow} from "@agenta/entities/workflow"
import {DrawerProps} from "antd"

type DrawerType = "variant" | "deployment"
type DrawerVariant = Workflow

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
