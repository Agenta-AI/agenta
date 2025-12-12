import {forwardRef} from "react"

import {Button, Tooltip} from "antd"
import {EnhancedButtonProps} from "./types"

const EnhancedButton = forwardRef<HTMLButtonElement, EnhancedButtonProps>(
    ({label, tooltipProps, ...props}: EnhancedButtonProps, ref) => {
        return (
            <Tooltip {...tooltipProps}>
                <Button {...props}>{label}</Button>
            </Tooltip>
        )
    },
)

export default EnhancedButton
