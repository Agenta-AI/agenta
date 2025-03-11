export interface GenerationComparisonChatOutputCellProps {
    variantId: string
    rowId: string
    historyId: string
    variantIndex?: number
    isFirstRow?: boolean
    isLastRow?: boolean
}

export interface GenerationComparisonChatOutputProps {
    historyId: string
    className?: string
    rowId: string
    isLastRow?: boolean
    isFirstRow?: boolean
}
