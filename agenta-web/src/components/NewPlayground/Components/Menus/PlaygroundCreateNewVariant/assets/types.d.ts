export type CreateNewVariantListProps = {
    selectedVariant?: string
    displayedVariants?: string[]
    onSelect?: (variantId: string) => void
    closeModal?: () => void
    className?: string
}

export type VariantItem = {
    variantId: string
    variantName: string
}
