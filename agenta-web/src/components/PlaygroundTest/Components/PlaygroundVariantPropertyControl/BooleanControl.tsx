import {memo} from "react"
import {Switch, Typography, type SwitchProps} from "antd"
import PlaygroundVariantPropertyControlWrapper from "./assets/PlaygroundVariantPropertyControlWrapper"

interface BooleanControlProps extends SwitchProps {
    label: string
}

const BooleanControl = ({label, value, onChange}: BooleanControlProps) => {
    return (
        <PlaygroundVariantPropertyControlWrapper className="!flex-row justify-between">
            <Typography.Text>{label}</Typography.Text>
            <Switch checked={value} onChange={onChange} />
        </PlaygroundVariantPropertyControlWrapper>
    )
}

export default memo(BooleanControl)
