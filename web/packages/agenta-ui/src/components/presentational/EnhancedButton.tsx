import {forwardRef, type ComponentPropsWithoutRef, type ReactNode} from "react"

import {Button} from "@agenta/primitive-ui/components/button"
import {Tooltip} from "antd"
import type {TooltipProps} from "antd"

export interface EnhancedButtonProps extends ComponentPropsWithoutRef<typeof Button> {
    label?: ReactNode
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
