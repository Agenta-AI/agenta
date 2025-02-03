import {EnhancedVariant} from "@/components/NewPlayground/assets/utilities/transformer/types"

export type CreateVariantModalProps = {
    isModalOpen: boolean
    setIsModalOpen: (value: boolean) => void
    addTab: () => void
    variants: Pick<EnhancedVariant, "variantName">[]
    setNewVariantName: (value: string) => void
    newVariantName: string
    setTemplateVariantName: (value: string) => void
}
