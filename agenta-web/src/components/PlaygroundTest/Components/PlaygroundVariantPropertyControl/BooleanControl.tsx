import { memo } from "react"
import { Switch, Typography, type SwitchProps } from "antd"

interface BooleanControlProps extends SwitchProps {
    label: string;
}

const BooleanControl = ({ label, value, onChange }: BooleanControlProps) => {
    return (
        <div className="flex items-center gap-2 justify-between">
            <Typography.Text>{label}</Typography.Text>
            <Switch checked={value} onChange={onChange} />
        </div>
    )
}

export default memo(BooleanControl)
