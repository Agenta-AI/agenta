import type {ReactNode} from "react"

import type {ButtonProps, TooltipProps} from "antd"

import type {UserOnboardingStatus} from "@/oss/state/onboarding/types"

export interface TriggerPayload {
    state: keyof UserOnboardingStatus
    tourId?: string
}

export interface OnboardingTriggerButtonProps {
    triggerOnboarding?: (payload: TriggerPayload | null) => void
    triggerPayload?: TriggerPayload
    tooltipTitle?: ReactNode
    tooltipProps?: TooltipProps
    buttonProps?: ButtonProps
    icon?: ReactNode
    children?: ReactNode
}
