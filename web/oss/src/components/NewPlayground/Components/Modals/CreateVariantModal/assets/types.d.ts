import {Dispatch, SetStateAction} from "react"

import {AddButtonProps} from "@/oss/components/NewPlayground/assets/AddButton"
import {EnhancedVariant} from "@/oss/components/NewPlayground/assets/utilities/transformer/types"

export interface NewVariantButtonProps extends AddButtonProps {
    children?: React.ReactNode
    onClick?: () => void
}

export interface CreateVariantModalContentProps {
    setTemplateVariantName: (value: string) => void
    setIsInputValid: Dispatch<SetStateAction<boolean>>
    newVariantName: string
    setNewVariantName: (value: string) => void
    setNameExists: Dispatch<SetStateAction<boolean>>
    variants: Pick<EnhancedVariant, "variantName">[]
    nameExists: boolean
    note: string
    setNote: Dispatch<SetStateAction<string>>
    setIsCompareMode: Dispatch<SetStateAction<boolean>>
    isCompareMode: boolean
}
