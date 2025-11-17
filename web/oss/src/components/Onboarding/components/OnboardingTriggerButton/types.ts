import type {UserOnboardingStatus} from "@/oss/state/onboarding/types"
import type {ButtonProps, TooltipProps} from "antd"
import type {ReactNode} from "react"

export type TriggerPayload = {
    state: keyof UserOnboardingStatus
    type?: "beginner" | "advanced"
}

export type OnboardingTriggerButtonProps = {
    triggerOnboarding?: (payload: TriggerPayload | null) => void
    triggerPayload?: TriggerPayload
    tooltipTitle?: ReactNode
    tooltipProps?: TooltipProps
    buttonProps?: ButtonProps
    icon?: ReactNode
    children?: ReactNode
}
