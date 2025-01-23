import {type SwitchProps} from "antd"

export interface BooleanControlProps extends SwitchProps {
    label: string
    withTooltip?: boolean
    description?: string
}
