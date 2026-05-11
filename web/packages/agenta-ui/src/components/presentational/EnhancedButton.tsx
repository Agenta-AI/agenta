import {forwardRef} from "react"

import {Button, Tooltip} from "antd"
import type {ButtonProps, TooltipProps} from "antd"

export interface EnhancedButtonProps extends ButtonProps {
    label?: React.ReactNode
    tooltipProps?: TooltipProps
}

const EnhancedButton = forwardRef<HTMLButtonElement, EnhancedButtonProps>(
    ({label, tooltipProps, ...props}: EnhancedButtonProps, ref) => {
        return (
            <Tooltip {...tooltipProps}>
                <Button ref={ref} {...props}>
                    {label}
                </Button>
            </Tooltip>
        )
    },
)

export default EnhancedButton
