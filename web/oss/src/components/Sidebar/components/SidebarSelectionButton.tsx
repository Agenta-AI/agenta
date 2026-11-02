import type {ComponentProps, MouseEventHandler} from "react"

import {SidebarSelectionButton as SidebarSelectionButtonView} from "@agenta/navigation-ui"
import type {ButtonProps} from "antd"

interface SidebarSelectionButtonProps extends Omit<
    ComponentProps<typeof SidebarSelectionButtonView>,
    "className" | "onClick"
> {
    /** Legacy antd-era bag — flattened onto the plain button; only these fields were used. */
    buttonProps?: ButtonProps
}

const SidebarSelectionButton = ({buttonProps, disabled, ...props}: SidebarSelectionButtonProps) => (
    <SidebarSelectionButtonView
        {...props}
        className={buttonProps?.className}
        onClick={buttonProps?.onClick as MouseEventHandler<HTMLButtonElement> | undefined}
        disabled={disabled || buttonProps?.disabled}
    />
)

export default SidebarSelectionButton
