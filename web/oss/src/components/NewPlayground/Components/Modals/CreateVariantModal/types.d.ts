import {EnhancedVariant} from "@/oss/components/NewPlayground/assets/utilities/transformer/types"

export interface CreateVariantModalProps {
    isModalOpen: boolean
    setIsModalOpen: (value: boolean) => void
    addTab: () => void
    variants: Pick<EnhancedVariant, "variantName">[]
    setNewVariantName: (value: string) => void
    newVariantName: string
    setTemplateVariantName: (value: string) => void
}
