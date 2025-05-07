import {Dispatch, SetStateAction} from "react"

import {AddButtonProps} from "@/oss/components/Playground/assets/AddButton"
import {EnhancedVariant} from "@/oss/components/Playground/assets/utilities/transformer/types"

export interface NewVariantButtonProps extends AddButtonProps {
    children?: React.ReactNode
    onClick?: () => void
}

export interface CreateVariantModalContentProps {
    setTemplateVariantName: (value: string) => void
    templateVariantName: string
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
