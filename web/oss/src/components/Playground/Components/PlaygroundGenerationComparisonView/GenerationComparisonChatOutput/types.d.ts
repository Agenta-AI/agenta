export interface GenerationComparisonChatOutputCellProps {
    variantId: string
    turnId: string
    variantIndex?: number
    isFirstRow?: boolean
    isLastRow?: boolean
}

export interface GenerationComparisonChatOutputProps {
    className?: string
    turnId: string
    isLastRow?: boolean
    isFirstRow?: boolean
}
