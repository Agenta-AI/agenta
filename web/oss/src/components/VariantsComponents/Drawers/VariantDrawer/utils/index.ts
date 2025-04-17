export const findVariantById = (variantsList: any, targetId: string): any => {
    for (const variant of variantsList) {
        if (variant.id === targetId) return variant
        if (variant.revisions?.length) {
            const found = findVariantById(variant?.revisions, targetId)
            if (found) return found
        }
    }
    return undefined
}
