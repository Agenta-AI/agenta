import {ReactNode} from "react"

import {ModalProps} from "antd"

import type {OnboardingControlLabels} from "@/oss/state/onboarding/types"

export interface NormalizedStepContent {
    icon: ReactNode
    title: ReactNode
    content: ReactNode
    showControls: boolean
    showSkip: boolean
    controlLabels?: OnboardingControlLabels
}

export interface WelcomeModalProps extends ModalProps {
    open: boolean
}
