import {ModalProps} from "antd"
import {ReactNode} from "react"

export interface NormalizedStepContent {
    icon: ReactNode
    title: ReactNode
    content: ReactNode
    showControls: boolean
    showSkip: boolean
}

export interface WelcomeModalProps extends ModalProps {
    open: boolean
}
