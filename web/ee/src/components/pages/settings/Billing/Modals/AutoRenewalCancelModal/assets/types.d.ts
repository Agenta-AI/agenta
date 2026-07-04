import {ChangeEvent} from "react"

export interface AutoRenewalCancelModalProps {
    open: boolean
    onClose: () => void
}

export interface AutoRenewalCancelModalContentProps {
    value: string
    onChange: (value: string) => void
    inputValue: string
    onChangeInput: (e: ChangeEvent<HTMLInputElement>) => void
}
