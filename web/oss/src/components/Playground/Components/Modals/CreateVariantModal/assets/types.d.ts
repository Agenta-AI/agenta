import {Dispatch, SetStateAction} from "react"

import {type AddButtonProps} from "@agenta/ui/components/presentational"

import {EnhancedVariant} from "@/oss/lib/shared/variant/types"

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
