import {memo} from "react"

import {Button, Space, Typography} from "antd"

interface ScenarioLoadingIndicatorProps {
    message?: string
}

const ScenarioLoadingIndicator = ({message}: ScenarioLoadingIndicatorProps) => (
    <Space align="center" className="justify-center w-full py-8">
        <Button type="text" loading />
        <Typography.Text type="secondary">{message ?? "Loading scenario..."}</Typography.Text>
    </Space>
)

export default memo(ScenarioLoadingIndicator)
