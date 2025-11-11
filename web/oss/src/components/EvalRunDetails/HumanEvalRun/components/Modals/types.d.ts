import {Dispatch, SetStateAction, ReactNode} from "react"

import {ModalProps, ButtonProps} from "antd"

export interface InstructionModalProps extends ModalProps {}

export interface RenameEvalModalProps extends ModalProps {
    id: string
    name: string
    description?: string
    runId?: string
}

export interface RenameEvalModalContentProps {
    loading?: boolean
    error: string | null
    editName: string
    setEditName: Dispatch<SetStateAction<string>>
    editDescription: string
    setEditDescription: Dispatch<SetStateAction<string>>
}

export interface RenameEvalButtonProps extends ButtonProps {
    id: string
    name: string
    description?: string
    runId?: string
    icon?: boolean
    children?: ReactNode
    label?: string
}
