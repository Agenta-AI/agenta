import {Dispatch, SetStateAction} from "react"

import {type ButtonProps} from "@agenta/ui/ui"

export interface NewVariantButtonProps extends ButtonProps {
    children?: React.ReactNode
    onClick?: () => void
    label?: string
}

export interface CreateVariantModalContentProps {
    setTemplateVariantName: (value: string) => void
    templateVariantName: string
    setIsInputValid: Dispatch<SetStateAction<boolean>>
    newVariantName: string
    setNewVariantName: (value: string) => void
    setNameExists: Dispatch<SetStateAction<boolean>>
    variants: {variantName?: string | null}[]
    nameExists: boolean
    note: string
    setNote: Dispatch<SetStateAction<string>>
    setIsCompareMode: Dispatch<SetStateAction<boolean>>
    isCompareMode: boolean
}
