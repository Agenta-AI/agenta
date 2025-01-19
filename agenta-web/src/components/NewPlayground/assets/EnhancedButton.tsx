import {forwardRef} from "react"

import {Button, Tooltip, type ButtonProps, TooltipProps} from "antd"

interface TooltipButtonProps extends ButtonProps {
    label?: string
    tooltipProps?: TooltipProps
}

const TooltipButton = forwardRef<HTMLButtonElement, TooltipButtonProps>(
    ({label, tooltipProps, ...props}: TooltipButtonProps, ref) => {
        return (
            <Tooltip {...tooltipProps}>
                <Button {...props}>{label}</Button>
            </Tooltip>
        )
    },
)

export default TooltipButton
