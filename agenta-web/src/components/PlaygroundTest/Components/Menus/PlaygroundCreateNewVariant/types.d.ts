import type {PopoverProps} from "antd"

export interface PlaygroundCreateNewVariantProps extends Omit<PopoverProps, "content"> {
    selectedVariant?: string
    displayedVariants?: string[]
    onSelect?: (variantId: string) => void
}
