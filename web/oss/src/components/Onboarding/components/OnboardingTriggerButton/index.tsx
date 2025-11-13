import {memo, useCallback, useMemo, MouseEvent} from "react"

import {QuestionCircleOutlined} from "@ant-design/icons"
import {Button, Tooltip} from "antd"
import type {ButtonProps, TooltipProps} from "antd"
import {resolveOnboardingSection, triggerOnboardingAtom} from "@/oss/state/onboarding"
import {useAtomValue, useSetAtom} from "jotai"
import {urlLocationAtom} from "@/oss/state/url"

import {OnboardingTriggerButtonProps} from "./types"

const OnboardingTriggerButton = ({
    triggerPayload,
    tooltipTitle,
    tooltipProps,
    buttonProps,
    children,
}: OnboardingTriggerButtonProps) => {
    const setTriggerOnboarding = useSetAtom(triggerOnboardingAtom)
    const userLocation = useAtomValue(urlLocationAtom)
    const normalizedSection = resolveOnboardingSection(userLocation.section)

    const handleClick: ButtonProps["onClick"] = useCallback(
        (event: MouseEvent<HTMLButtonElement>) => {
            buttonProps?.onClick?.(event)
            const payload =
                triggerPayload ?? (normalizedSection ? {state: normalizedSection} : null)
            if (!payload) return
            setTriggerOnboarding(payload)
        },
        [buttonProps, triggerPayload, normalizedSection, setTriggerOnboarding],
    )

    const effectiveTooltipTitle =
        tooltipTitle ?? "Need a hand? Launch the guided walkthrough for this page."
    const mergedTooltipProps: TooltipProps = useMemo(
        () => ({
            mouseEnterDelay: 0.5,
            ...tooltipProps,
            title: tooltipProps?.title ?? effectiveTooltipTitle,
        }),
        [tooltipProps, effectiveTooltipTitle],
    )

    return (
        <Tooltip {...mergedTooltipProps}>
            <Button
                {...buttonProps}
                type={buttonProps?.type ?? "text"}
                size={buttonProps?.size ?? "small"}
                icon={<QuestionCircleOutlined />}
                onClick={handleClick}
            >
                {children}
            </Button>
        </Tooltip>
    )
}

export default memo(OnboardingTriggerButton)
