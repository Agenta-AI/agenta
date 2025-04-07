import {Variant} from "@/oss/lib/Types"
import {ButtonProps} from "antd"

export interface CommitVariantChangesButtonProps extends ButtonProps {
    variantId: string
    label?: React.ReactNode
    icon?: boolean
    children?: React.ReactNode
}

export interface CommitVariantChangesModalContentProps {
    variantId: string
    note: string
    setNote: React.Dispatch<React.SetStateAction<string>>
    selectedCommitType: SelectedCommitType | null
    setSelectedCommitType: React.Dispatch<React.SetStateAction<SelectedCommitType | null>>
}
