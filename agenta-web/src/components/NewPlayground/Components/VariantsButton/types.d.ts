import type {PopoverProps} from "antd"

export interface VariantItem {
    variantId: string
    variantName: string
}

export interface VariantsListProps {
    selectedVariant?: string
    displayedVariants?: string[]
    onSelect?: (variantId: string) => void
    closeModal?: () => void
}

export interface VariantsButtonProps extends Omit<PopoverProps, "content"> {
    selectedVariant?: string
    displayedVariants?: string[]
    onSelect?: (variantId: string) => void
}
