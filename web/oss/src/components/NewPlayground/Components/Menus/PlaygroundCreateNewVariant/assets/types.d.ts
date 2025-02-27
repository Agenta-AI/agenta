export interface CreateNewVariantListProps {
    selectedVariant?: string
    displayedVariants?: string[]
    onSelect?: (variantId: string) => void
    closeModal?: () => void
    className?: string
}

export interface VariantItem {
    variantId: string
    variantName: string
}
