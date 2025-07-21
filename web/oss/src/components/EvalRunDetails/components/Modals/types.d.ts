import {ModalProps, ButtonProps} from "antd"
import React from "react"

export interface InstructionModalProps extends ModalProps {}

export interface RenameEvalModalProps extends ModalProps {
    id: string
    name: string
    description?: string
}

export interface RenameEvalModalContentProps {
    loading?: boolean
    error: string | null
    editName: string
    setEditName: React.Dispatch<React.SetStateAction<string>>
    editDescription: string
    setEditDescription: React.Dispatch<React.SetStateAction<string>>
}

export interface RenameEvalButtonProps extends ButtonProps {
    id: string
    name: string
    description?: string
    icon?: boolean
    children?: React.ReactNode
    label?: string
}
    
