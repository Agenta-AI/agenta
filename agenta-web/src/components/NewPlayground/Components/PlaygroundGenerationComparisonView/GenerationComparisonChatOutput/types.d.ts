export type GenerationComparisonChatOutputCellProps = {
    variantId: string
    rowId: string
    historyId: string
    variantIndex?: number
    isFirstRow?: boolean
    isLastRow?: boolean
    isLastVariant?: boolean
}

export type GenerationComparisonChatOutputProps = {
    historyId: string
    className?: string
    rowId: string
    isLastRow?: boolean
    isFirstRow?: boolean
}
