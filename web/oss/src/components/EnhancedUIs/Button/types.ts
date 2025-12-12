import { ButtonProps, TooltipProps } from "antd"

export interface EnhancedButtonProps extends ButtonProps {
    label?: React.ReactNode
    tooltipProps?: TooltipProps
}