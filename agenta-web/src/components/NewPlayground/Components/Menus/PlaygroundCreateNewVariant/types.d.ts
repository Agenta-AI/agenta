import type {ButtonProps, PopoverProps} from "antd"

interface Button extends ButtonProps {
    label?: string
}
export interface PlaygroundCreateNewVariantProps extends Omit<PopoverProps, "content"> {
    selectedVariant?: string
    displayedVariants?: string[]
    onSelect?: (variantId: string) => void
    buttonProps?: Button
}
