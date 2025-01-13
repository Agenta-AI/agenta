export type GenerationCompletionProps = {
    variantId: string
    className?: string
    rowClassName?: string
    // inputOnly is used to render only the input-varible and avoid other elements, for now we are using inputOnly on GenerationFocusDrawer
    inputOnly?: boolean
}
