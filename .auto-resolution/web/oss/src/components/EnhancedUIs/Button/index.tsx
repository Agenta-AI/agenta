import {forwardRef} from "react"

import {Button, Tooltip} from "antd"

import {EnhancedButtonProps} from "./types"

const EnhancedButton = forwardRef<HTMLButtonElement, EnhancedButtonProps>(
    ({label, tooltipProps, ...props}: EnhancedButtonProps, ref) => {
        const button = (
            <Button ref={ref} {...props}>
                {label}
            </Button>
        )
        // No tooltip content → skip the Tooltip/Trigger wrapper (a per-button render cost).
        if (tooltipProps?.title == null || tooltipProps.title === "") return button
        return <Tooltip {...tooltipProps}>{button}</Tooltip>
    },
)
EnhancedButton.displayName = "EnhancedButton"

export default EnhancedButton
