import {memo} from "react"

import {Button, Space} from "antd"

interface ScenarioLoadingIndicatorProps {
    message?: string
}

const ScenarioLoadingIndicator = ({message}: ScenarioLoadingIndicatorProps) => (
    <Space align="center" className="justify-center w-full py-8">
        <Button type="text" loading />
        <span className="text-muted-foreground">{message ?? "Loading scenario..."}</span>
    </Space>
)

export default memo(ScenarioLoadingIndicator)
